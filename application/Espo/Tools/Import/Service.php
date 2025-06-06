<?php
/************************************************************************
 * This file is part of EspoCRM.
 *
 * EspoCRM - Open Source CRM application.
 * Copyright (C) 2014-2023 Yurii Kuznietsov, Taras Machyshyn, Oleksii Avramenko
 * Website: https://www.espocrm.com
 *
 * EspoCRM is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * EspoCRM is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with EspoCRM. If not, see http://www.gnu.org/licenses/.
 *
 * The interactive user interfaces in modified source and object code versions
 * of this program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU General Public License version 3.
 *
 * In accordance with Section 7(b) of the GNU General Public License version 3,
 * these Appropriate Legal Notices must retain the display of the "EspoCRM" word.
 ************************************************************************/

namespace Espo\Tools\Import;

use Espo\Entities\ActionHistoryRecord;
use Espo\ORM\Entity;
use Espo\ORM\Query\DeleteBuilder;
use Espo\ORM\Type\RelationType;
use GuzzleHttp\Psr7\Utils as Psr7Utils;

use Espo\Core\ORM\Repository\Option\SaveOption;
use Espo\Entities\ImportEntity as ImportEntityEntity;
use Espo\Core\Exceptions\Error;
use Espo\Core\Exceptions\NotFound;
use Espo\Core\Exceptions\Forbidden;
use Espo\Core\FileStorage\Manager as FileStorageManager;
use Espo\Core\Record\ServiceContainer;
use Espo\Core\Acl;
use Espo\Core\Acl\Table;
use Espo\Entities\ImportError;
use Espo\ORM\Collection;
use Espo\ORM\EntityManager;
use Espo\Entities\Import as ImportEntity;
use Espo\Entities\Attachment;

use DateTime;
use SplFileObject;
use RuntimeException;

class Service
{
    private const REVERT_PERMANENTLY_REMOVE_PERIOD_DAYS = 2;

    public function __construct(
        private ImportFactory $factory,
        private ServiceContainer $recordServiceContainer,
        private EntityManager $entityManager,
        private Acl $acl,
        private FileStorageManager $fileStorageManager
    ) {}

    /**
     * @param string[] $attributeList
     * @param string $attachmentId
     * @throws Forbidden
     * @throws Error
     */
    public function import(
        string $entityType,
        array $attributeList,
        string $attachmentId,
        Params $params
    ): Result {

        if (!$this->acl->checkScope(ImportEntity::ENTITY_TYPE)) {
            throw new Forbidden("No access to Import scope.");
        }

        if (!$this->acl->check($entityType, Table::ACTION_CREATE)) {
            throw new Forbidden("No create access for '{$entityType}'.");
        }

        $result = $this->factory
            ->create()
            ->setEntityType($entityType)
            ->setAttributeList($attributeList)
            ->setAttachmentId($attachmentId)
            ->setParams($params)
            ->run();

        $id = $result->getId();

        if ($id) {
            $import = $this->entityManager->getEntity(ImportEntity::ENTITY_TYPE, $id);

            if ($import) {
                $this->recordServiceContainer
                    ->get(ImportEntity::ENTITY_TYPE)
                    ->processActionHistoryRecord(ActionHistoryRecord::ACTION_CREATE, $import);
            }
        }

        return $result;
    }

    /**
     * @throws Forbidden
     * @throws Error
     */
    public function importContentsWithParamsId(string $contents, string $importParamsId): Result
    {
        if (!$contents) {
            throw new Error("Contents is empty.");
        }

        /** @var ?ImportEntity $source */
        $source = $this->entityManager->getEntityById(ImportEntity::ENTITY_TYPE, $importParamsId);

        if (!$source) {
            throw new Error("Import '{$importParamsId}' not found.");
        }

        $entityType = $source->getTargetEntityType();
        $attributeList = $source->getTargetAttributeList() ?? [];

        if (!$entityType) {
            throw new Error("No entity-type.");
        }

        $params = $source->getParams()
            ->withIdleMode(false)
            ->withManualMode(false);

        $attachmentId = $this->uploadFile($contents);

        return $this->import($entityType, $attributeList, $attachmentId, $params);
    }

    /**
     * @throws Forbidden
     * @throws Error
     * @throws NotFound
     */
    public function importById(string $id, bool $startFromLastIndex = false, bool $forceResume = false): Result
    {
        /** @var ?ImportEntity $import */
        $import = $this->entityManager->getEntity(ImportEntity::ENTITY_TYPE, $id);

        if (!$import) {
            throw new NotFound("Import '{$id}' not found.");
        }

        $status = $import->getStatus();

        if ($status !== ImportEntity::STATUS_STANDBY) {
            if (!in_array($status, [ImportEntity::STATUS_IN_PROCESS, ImportEntity::STATUS_FAILED])) {
                throw new Forbidden("Can't run import with '{$status}' status.");
            }

            if (!$forceResume) {
                throw new Forbidden("Import has '{$status}' status. Use -r flag to force resume.");
            }
        }

        $entityType = $import->getTargetEntityType();
        $attributeList = $import->getTargetAttributeList() ?? [];

        if (!$entityType) {
            throw new Error("No entity-type.");
        }

        $params = $import->getParams()
            ->withStartFromLastIndex($startFromLastIndex);

        $attachmentId = $import->getFileId();

        if (!$attachmentId) {
            throw new Error("No file-id.");
        }

        return $this->factory
            ->create()
            ->setEntityType($entityType)
            ->setAttributeList($attributeList)
            ->setAttachmentId($attachmentId)
            ->setParams($params)
            ->setId($id)
            ->run();
    }

    /**
     * @throws Forbidden
     * @throws NotFound
     */
    public function revert(string $id): void
    {
        if (!$this->acl->checkScope(ImportEntity::ENTITY_TYPE)) {
            throw new Forbidden("No access to Import scope.");
        }

        $import = $this->entityManager->getEntityById(ImportEntity::ENTITY_TYPE, $id);

        if (!$import) {
            throw new NotFound("Could not find import record.");
        }

        if (!$this->acl->checkEntityDelete($import)) {
            throw new Forbidden("No access to import record.");
        }

        $importEntityList = $this->entityManager
            ->getRDBRepository(ImportEntityEntity::ENTITY_TYPE)
            ->sth()
            ->where([
                'importId' => $import->getId(),
                'isImported' => true,
            ])
            ->find();

        $removeFromDb = false;

        $createdAt = $import->get('createdAt');

        if ($createdAt) {
            $dtNow = new DateTime();
            $createdAtDt = new DateTime($createdAt);

            $dayDiff = ($dtNow->getTimestamp() - $createdAtDt->getTimestamp()) / 60 / 60 / 24;

            if ($dayDiff < self::REVERT_PERMANENTLY_REMOVE_PERIOD_DAYS) {
                $removeFromDb = true;
            }
        }

        foreach ($importEntityList as $importEntity) {
            $entityType = $importEntity->get('entityType');
            $entityId = $importEntity->get('entityId');

            if (!$entityType || !$entityId) {
                continue;
            }

            if (!$this->entityManager->hasRepository($entityType)) {
                continue;
            }

            $entity = $this->entityManager
                ->getRDBRepository($entityType)
                ->select(['id'])
                ->where(['id' => $entityId])
                ->findOne();

            if (!$entity) {
                continue;
            }

            if ($removeFromDb) {
                $this->deleteRelations($entity);
            }

            $this->entityManager->removeEntity($entity, [
                'noStream' => true,
                'noNotifications' => true,
                SaveOption::SILENT => true,
                SaveOption::IMPORT => true,
            ]);

            if ($removeFromDb) {
                $this->entityManager
                    ->getRDBRepository($entityType)
                    ->deleteFromDb($entityId);
            }
        }

        $this->entityManager->removeEntity($import);

        $this->recordServiceContainer
            ->get(ImportEntity::ENTITY_TYPE)
            ->processActionHistoryRecord(ActionHistoryRecord::ACTION_DELETE, $import);
    }

    private function deleteRelations(Entity $entity): void
    {
        $relationDefsList = $this->entityManager
            ->getDefs()
            ->getEntity($entity->getEntityType())
            ->getRelationList();

        foreach ($relationDefsList as $relationDefs) {
            if ($relationDefs->getType() !== RelationType::MANY_MANY) {
                continue;
            }

            $middleEntityType = ucfirst($relationDefs->getRelationshipName());

            $midKey = $relationDefs->getMidKey();

            $where = [$midKey => $entity->getId()];

            foreach ($relationDefs->getConditions() as $key => $value) {
                $where[$key] = $value;
            }

            $deleteQuery = DeleteBuilder::create()
                ->from($middleEntityType)
                ->where($where)
                ->build();

            $this->entityManager
                ->getQueryExecutor()
                ->execute($deleteQuery);
        }
    }

    /**
     * @return string Attachment ID.
     * @throws Forbidden
     */
    public function uploadFile(string $contents): string
    {
        if (!$this->acl->checkScope(ImportEntity::ENTITY_TYPE)) {
            throw new Forbidden("No access to Import scope.");
        }

        $attachment = $this->entityManager->getNewEntity(Attachment::ENTITY_TYPE);

        $attachment->set('type', 'text/csv');
        $attachment->set('role', 'Import File');
        $attachment->set('name', 'import-file.csv');
        $attachment->set('contents', $contents);

        $this->entityManager->saveEntity($attachment);

        return $attachment->getId();
    }

    /**
     * @throws Forbidden
     * @throws NotFound
     */
    public function removeDuplicates(string $id): void
    {
        if (!$this->acl->checkScope(ImportEntity::ENTITY_TYPE)) {
            throw new Forbidden("No access to Import scope.");
        }

        $import = $this->entityManager->getEntityById(ImportEntity::ENTITY_TYPE, $id);

        if (!$import) {
            throw new NotFound("Import '{$id}' not found.");
        }

        if (!$this->acl->checkEntityDelete($import)) {
            throw new Forbidden("No delete access.");
        }

        $importEntityList = $this->entityManager
            ->getRDBRepository(ImportEntityEntity::ENTITY_TYPE)
            ->sth()
            ->where([
                'importId' => $import->getId(),
                'isDuplicate' => true,
            ])
            ->find();

        foreach ($importEntityList as $importEntity) {
            $entityType = $importEntity->get('entityType');
            $entityId = $importEntity->get('entityId');

            if (!$entityType || !$entityId) {
                continue;
            }

            if (!$this->entityManager->hasRepository($entityType)) {
                continue;
            }

            $entity = $this->entityManager
                ->getRDBRepository($entityType)
                ->select(['id'])
                ->where(['id' => $entityId])
                ->findOne();

            if (!$entity) {
                continue;
            }

            $this->deleteRelations($entity);

            $this->entityManager->removeEntity($entity, [
                'noStream' => true,
                'noNotifications' => true,
                SaveOption::SILENT => true,
                SaveOption::IMPORT => true,
            ]);

            $this->entityManager
                ->getRDBRepository($entityType)
                ->deleteFromDb($entityId);
        }
    }

    /**
     * @throws NotFound
     * @throws Forbidden
     */
    public function unmarkAsDuplicate(string $importId, string $entityType, string $entityId): void
    {
        if (!$this->acl->checkScope(ImportEntity::ENTITY_TYPE)) {
            throw new Forbidden("No access to Import scope.");
        }

        $entity = $this->entityManager
            ->getRDBRepository(ImportEntityEntity::ENTITY_TYPE)
            ->where([
                'importId' => $importId,
                'entityType' => $entityType,
                'entityId' => $entityId,
            ])
            ->findOne();

        if (!$entity) {
            throw new NotFound();
        }

        $entity->set('isDuplicate', false);

        $this->entityManager->saveEntity($entity);
    }

    /**
     * @param string $importId An import ID.
     * @return ?string An attachment ID.
     * @throws NotFound
     */
    public function exportErrors(string $importId): ?string
    {
        $import = $this->entityManager
            ->getRepositoryByClass(ImportEntity::class)
            ->getById($importId);

        if (!$import) {
            throw new NotFound();
        }

        $count = $this->entityManager
            ->getRDBRepositoryByClass(ImportEntity::class)
            ->getRelation($import, 'errors')
            ->count();

        if ($count === 0) {
            return null;
        }

        $importAttachmentId = $import->getFileId();

        if (!$importAttachmentId) {
            throw new RuntimeException("No import file ID.");
        }

        $importAttachment = $this->entityManager
            ->getRepositoryByClass(Attachment::class)
            ->getById($importAttachmentId);

        if (!$importAttachment) {
            throw new RuntimeException("No import attachment.");
        }

        $filePath = $this->fileStorageManager->getLocalFilePath($importAttachment);

        $file = new SplFileObject($filePath);

        $resource = fopen('php://temp', 'w+');

        if ($resource === false) {
            throw new RuntimeException("Could not open temp.");
        }

        $stream = Psr7Utils::streamFor($resource);

        /** @var Collection<ImportError> $errorList */
        $errorList = $this->entityManager
            ->getRDBRepositoryByClass(ImportEntity::class)
            ->getRelation($import, 'errors')
            ->sth()
            ->select(['exportRowIndex', 'rowIndex'])
            ->order('rowIndex')
            ->find();

        if ($import->getParams()->headerRow()) {
            $file->seek(0);

            /** @var string|false $line */
            $line = $file->current();

            if ($line === false) {
                throw new RuntimeException();
            }

            $stream->write($line);
        }

        foreach ($errorList as $error) {
            $file->seek($error->getRowIndex());

            /** @var string|false $line */
            $line = $file->current();

            if ($line === false) {
                throw new RuntimeException();
            }

            $stream->write($line);
        }

        $name = 'Errors_' . substr($importAttachment->getName() ?? '', 0, -4) . '.csv';

        $attachment = $this->entityManager->getRepositoryByClass(Attachment::class)->getNew();

        $attachment->setRole(Attachment::ROLE_EXPORT_FILE);
        $attachment->setType('text/csv');
        $attachment->setName($name);
        $attachment->setSize($stream->getSize());

        $this->entityManager->saveEntity($attachment);

        $this->fileStorageManager->putStream($attachment, $stream);

        fclose($resource);

        return $attachment->getId();
    }
}
