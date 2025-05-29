<?php
return [
  'database' => [
    'host' => 'localhost',
    'port' => '',
    'charset' => NULL,
    'dbname' => 'espocrm',
    'user' => 'espouser',
    'password' => 'StrongPassword123!',
    'driver' => 'pdo_mysql'
  ],
  'smtpPassword' => 'Insta06192787',
  'logger' => [
    'path' => 'data/logs/espo.log',
    'level' => 'WARNING',
    'rotation' => true,
    'maxFileNumber' => 30,
    'printTrace' => false
  ],
  'restrictedMode' => false,
  'webSocketMessager' => 'ZeroMQ',
  'clientSecurityHeadersDisabled' => false,
  'clientCspDisabled' => false,
  'clientCspScriptSourceList' => [
    0 => 'https://maps.googleapis.com'
  ],
  'isInstalled' => true,
  'microtimeInternal' => 1748516837.302494,
  'passwordSalt' => '553c67c8ba3e0536',
  'cryptKey' => '9706148803fb3d01423391110e824d1b',
  'hashSecretKey' => 'e4b5908e7701c1c49d2642137a30f14f',
  'defaultPermissions' => [
    'user' => 33,
    'group' => 33
  ],
  'actualDatabaseType' => 'mysql',
  'actualDatabaseVersion' => '8.0.42'
];
