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

define('views/list-related', ['views/main', 'search-manager'],
function (Dep, /** typeof module:search-manager.Class */SearchManager) {

    /**
     * A list-related view page.
     *
     * @class
     * @name Class
     * @extends module:views/main.Class
     * @memberOf module:views/list
     */
    return Dep.extend(/** @lends module:views/list-related.Class# */{

        /**
         * @inheritDoc
         */
        template: 'list',

        /**
         * @inheritDoc
         */
        scope: null,

        /**
         * @inheritDoc
         */
        name: 'ListRelated',

        /**
         * A header view name.
         *
         * @type {string}
         */
        headerView: 'views/header',

        /**
         * A search view name.
         *
         * @type {string}
         */
        searchView: 'views/record/search',

        /**
         * A record/list view name.
         *
         * @type {string}
         */
        recordView: 'views/record/list',

        /**
         * Has a search panel.
         *
         * @type {boolean}
         */
        searchPanel: true,

        /**
         * @type {module:search-manager.Class}
         */
        searchManager: null,

        /**
         * @inheritDoc
         */
        optionsToPass: [],

        /**
         * Use a current URL as a root URL when open a record. To be able to return to the same URL.
         */
        keepCurrentRootUrl: false,

        /**
         * A view mode.
         *
         * @type {string}
         */
        viewMode: null,

        /**
         * An available view mode list.
         *
         * @type {string[]}
         */
        viewModeList: null,

        /**
         * A default view mode.
         *
         * @type {string}
         */
        defaultViewMode: 'list',

        /**
         * @const
         */
        MODE_LIST: 'list',

        /**
         * @private
         */
        rowActionsView: 'views/record/row-actions/relationship',

        /**
         * A create button.
         *
         * @protected
         */
        createButton: true,

        /**
         * @protected
         */
        unlinkDisabled: false,

        /**
         * @protected
         */
        filtersDisabled: false,

        /**
         * @inheritDoc
         */
        shortcutKeys: {
            'Control+Space': function (e) {
                this.handleShortcutKeyCtrlSpace(e);
            },
            'Control+Slash': function (e) {
                this.handleShortcutKeyCtrlSlash(e);
            },
            'Control+Comma': function (e) {
                this.handleShortcutKeyCtrlComma(e);
            },
            'Control+Period': function (e) {
                this.handleShortcutKeyCtrlPeriod(e);
            },
        },

        /**
         * @inheritDoc
         */
        setup: function () {
            this.link = this.options.link;

            if (!this.link) {
                console.error(`Link not passed.`);
                throw new Error();
            }

            if (!this.model) {
                console.error(`Model not passed.`);
                throw new Error();
            }

            if (!this.collection) {
                console.error(`Collection not passed.`);
                throw new Error();
            }

            this.panelDefs = this.getMetadata().get(['clientDefs', this.scope, 'relationshipPanels', this.link]) || {};

            if (this.panelDefs.fullFormDisabled) {
                console.error(`Full-form disabled.`);
                throw new Error();
            }

            this.collection.maxSize = this.getConfig().get('recordsPerPage') || this.collection.maxSize;
            this.collectionUrl = this.collection.url;
            this.collectionMaxSize = this.collection.maxSize;

            this.foreignScope = this.collection.entityType;

            this.setupModes();
            this.setViewMode(this.viewMode);

            if (this.getMetadata().get(['clientDefs', this.foreignScope, 'searchPanelDisabled'])) {
                this.searchPanel = false;
            }

            if (this.getUser().isPortal()) {
                if (this.getMetadata().get(['clientDefs', this.foreignScope, 'searchPanelInPortalDisabled'])) {
                    this.searchPanel = false;
                }
            }

            if (this.getMetadata().get(['clientDefs', this.foreignScope, 'createDisabled'])) {
                this.createButton = false;
            }

            if (
                this.panelDefs.create === false ||
                this.panelDefs.createDisabled ||
                this.panelDefs.createAction
            ) {
                this.createButton = false;
            }

            this.entityType = this.collection.name;

            this.headerView = this.options.headerView || this.headerView;
            this.recordView = this.options.recordView || this.recordView;
            this.searchView = this.options.searchView || this.searchView;

            this.setupHeader();

            this.defaultOrderBy = this.panelDefs.orderBy || this.collection.orderBy;
            this.defaultOrder = this.panelDefs.orderDirection || this.collection.order;

            if (this.panelDefs.orderBy && !this.panelDefs.orderDirection) {
                this.defaultOrder = 'asc';
            }

            this.collection.setOrder(this.defaultOrderBy, this.defaultOrder, true);

            if (this.searchPanel) {
                this.setupSearchManager();
            }

            this.setupSorting();

            if (this.searchPanel) {
                this.setupSearchPanel();
            }

            if (this.createButton) {
                this.setupCreateButton();
            }

            if (this.options.params && this.options.params.fromAdmin) {
                this.keepCurrentRootUrl = true;
            }

            this.getHelper().processSetupHandlers(this, 'list');
        },

        /**
         * Set up modes.
         */
        setupModes: function () {
            this.defaultViewMode = this.options.defaultViewMode ||
                this.getMetadata().get(['clientDefs', this.foreignScope, 'listRelatedDefaultViewMode']) ||
                this.defaultViewMode;

            this.viewMode = this.viewMode || this.defaultViewMode;

            let viewModeList = this.options.viewModeList ||
                this.viewModeList ||
                this.getMetadata().get(['clientDefs', this.foreignScope, 'listRelatedViewModeList']);

            this.viewModeList = viewModeList ? viewModeList : [this.MODE_LIST];

            if (this.viewModeList.length > 1) {
                this.viewMode = null;

                let modeKey = 'listRelatedViewMode' + this.scope + this.link;

                if (this.getStorage().has('state', modeKey)) {
                    let storedViewMode = this.getStorage().get('state', modeKey);

                    if (storedViewMode) {
                        if (~this.viewModeList.indexOf(storedViewMode)) {
                            this.viewMode = storedViewMode;
                        }
                    }
                }

                if (!this.viewMode) {
                    this.viewMode = this.defaultViewMode;
                }
            }
        },

        /**
         * Set up a header.
         */
        setupHeader: function () {
            this.createView('header', this.headerView, {
                collection: this.collection,
                el: '#main > .page-header',
                scope: this.scope,
                isXsSingleRow: true,
            });
        },

        /**
         * Set up a create button.
         */
        setupCreateButton: function () {
            this.menu.buttons.unshift({
                action: 'quickCreate',
                iconHtml: '<span class="fas fa-plus fa-sm"></span>',
                text: this.translate('Create ' + this.foreignScope, 'labels', this.foreignScope),
                style: 'default',
                acl: 'create',
                aclScope: this.foreignScope,
                title: 'Ctrl+Space',
            });
        },

        /**
         * Set up a search panel.
         *
         * @protected
         */
        setupSearchPanel: function () {
            this.createSearchView();
        },

        /**
         * Create a search view.
         *
         * @return {Promise<module:view.Class>}
         * @protected
         */
        createSearchView: function () {
            let filterList = Espo.Utils
                .clone(this.getMetadata().get(['clientDefs', this.foreignScope, 'filterList']) || []);

            if (this.panelDefs.filterList) {
                this.panelDefs.filterList.forEach(item1 => {
                    let isFound = false;
                    let name1 = item1.name || item1;

                    if (!name1 || name1 === 'all') {
                        return;
                    }

                    filterList.forEach(item2 => {
                        let name2 = item2.name || item2;

                        if (name1 === name2) {
                            isFound = true;
                        }
                    });

                    if (!isFound) {
                        filterList.push(item1);
                    }
                });
            }

            if (this.filtersDisabled) {
                filterList = [];
            }

            return this.createView('search', this.searchView, {
                collection: this.collection,
                el: '#main > .search-container',
                searchManager: this.searchManager,
                scope: this.foreignScope,
                viewMode: this.viewMode,
                viewModeList: this.viewModeList,
                isWide: true,
                filterList: filterList,
            }, view => {
                if (this.viewModeList.length > 1) {
                    this.listenTo(view, 'change-view-mode', () => this.switchViewMode());
                }
            });
        },

        /**
         * Switch a view mode.
         *
         * @param {string} mode
         */
        switchViewMode: function (mode) {
            this.clearView('list');
            this.collection.isFetched = false;
            this.collection.reset();
            this.setViewMode(mode, true);
            this.loadList();
        },

        /**
         * Set a view mode.
         *
         * @param {string} mode A mode.
         * @param {boolean} [toStore=false] To preserve a mode being set.
         */
        setViewMode: function (mode, toStore) {
            this.viewMode = mode;

            this.collection.url = this.collectionUrl;
            this.collection.maxSize = this.collectionMaxSize;

            if (toStore) {
                var modeKey = 'listViewMode' + this.scope + this.link;

                this.getStorage().set('state', modeKey, mode);
            }

            if (this.searchView && this.getView('search')) {
                this.getView('search').setViewMode(mode);
            }

            let methodName = 'setViewMode' + Espo.Utils.upperCaseFirst(this.viewMode);

            if (this[methodName]) {
                this[methodName]();
            }
        },

        /**
         * Set up a search manager.
         */
        setupSearchManager: function () {
            let collection = this.collection;

            let searchManager = new SearchManager(
                collection,
                'list',
                null,
                this.getDateTime(),
                null
            );

            searchManager.scope = this.foreignScope;

            collection.where = searchManager.getWhere();

            this.searchManager = searchManager;
        },

        /**
         * Set up sorting.
         */
        setupSorting: function () {
            if (!this.searchPanel) {
                return;
            }
        },

        /**
         * @protected
         * @return {?module:views/record/search.Class}
         */
        getSearchView: function () {
            return this.getView('search');
        },

        /**
         * @protected
         * @return {?module:view}
         */
        getRecordView: function () {
            return this.getView('list');
        },

        /**
         * Get a record view name.
         *
         * @returns {string}
         */
        getRecordViewName: function () {
            if (this.viewMode === this.MODE_LIST) {
                return this.panelDefs.recordListView ||
                    this.getMetadata().get(['clientDefs', this.foreignScope, 'recordViews', this.MODE_LIST]) ||
                        this.recordView;
            }

            let propertyName = 'record' + Espo.Utils.upperCaseFirst(this.viewMode) + 'View';

            return this.getMetadata().get(['clientDefs', this.foreignScope, 'recordViews', this.viewMode]) ||
                this[propertyName];
        },

        /**
         * @inheritDoc
         */
        afterRender: function () {
            Espo.Ui.notify(false);

            if (!this.hasView('list')) {
                this.loadList();
            }

            this.$el.get(0).focus({preventScroll: true});
        },

        /**
         * Load a record list view.
         */
        loadList: function () {
            let methodName = 'loadList' + Espo.Utils.upperCaseFirst(this.viewMode);

            if (this[methodName]) {
                this[methodName]();

                return;
            }

            if (this.collection.isFetched) {
                this.createListRecordView(false);

                return;
            }

            Espo.Ui.notify(' ... ');

            this.createListRecordView(true);
        },

        /**
         * Prepare record view options. Options can be modified in an extended method.
         *
         * @param {Object} options Options
         */
        prepareRecordViewOptions: function (options) {},

        /**
         * Create a record list view.
         */
        createListRecordView: function () {
            let o = {
                collection: this.collection,
                el: this.options.el + ' .list-container',
                scope: this.foreignScope,
                skipBuildRows: true,
                shortcutKeysEnabled: true,
            };

            this.optionsToPass.forEach(option => {
                o[option] = this.options[option];
            });

            if (this.keepCurrentRootUrl) {
                o.keepCurrentRootUrl = true;
            }

            if (this.panelDefs.layout && typeof this.panelDefs.layout === 'string') {
                o.layoutName = this.panelDefs.layout;
            }

            o.rowActionsView = this.panelDefs.readOnly ? false :
                (this.panelDefs.rowActionsView || this.rowActionsView);

            if (
                this.getConfig().get('listPagination') ||
                this.getMetadata().get(['clientDefs', this.foreignScope, 'listPagination'])
            ) {
                o.pagination = true;
            }

            let massUnlinkDisabled = this.panelDefs.massUnlinkDisabled ||
                this.panelDefs.unlinkDisabled || this.unlinkDisabled;

            o = {
                unlinkMassAction: !massUnlinkDisabled,
                skipBuildRows: true,
                buttonsDisabled: true,
                forceDisplayTopBar: true,
                rowActionsOptions:  {
                    unlinkDisabled: this.panelDefs.unlinkDisabled || this.unlinkDisabled,
                },
                ...o
            };

            this.prepareRecordViewOptions(o);

            let listViewName = this.getRecordViewName();

            this.createView('list', listViewName, o, view =>{
                if (!this.hasParentView()) {
                    view.undelegateEvents();

                    return;
                }

                this.listenToOnce(view, 'after:render', () => {
                    if (!this.hasParentView()) {
                        view.undelegateEvents();

                        this.clearView('list');
                    }
                });

                view.getSelectAttributeList(selectAttributeList => {
                    if (this.options.mediator && this.options.mediator.abort) {
                        return;
                    }

                    if (selectAttributeList) {
                        this.collection.data.select = selectAttributeList.join(',');
                    }

                    Espo.Ui.notify(' ... ');

                    this.collection.fetch({main: true})
                        .then(() => Espo.Ui.notify(false));
                });
            });
        },

        /**
         * A quick-create action.
         *
         * @protected
         */
        actionQuickCreate: function () {
            let link = this.link;
            let foreignScope = this.foreignScope;
            let foreignLink = this.model.getLinkParam(link, 'foreign');

            let attributes = {};

            let attributeMap = this.getMetadata()
                    .get(['clientDefs', this.scope, 'relationshipPanels', link, 'createAttributeMap']) || {};

            Object.keys(attributeMap)
                .forEach(attr => {
                    attributes[attributeMap[attr]] = this.model.get(attr);
                });

            Espo.Ui.notify(' ... ');

            let handler = this.getMetadata()
                .get(['clientDefs', this.scope, 'relationshipPanels', link, 'createHandler']);

            (new Promise(resolve => {
                if (!handler) {
                    resolve({});

                    return;
                }

                Espo.loader.requirePromise(handler)
                    .then(Handler => new Handler(this.getHelper()))
                    .then(handler => {
                        handler.getAttributes(this.model)
                            .then(attributes => resolve(attributes));
                    });
            }))
                .then(additionalAttributes => {
                    attributes = {...attributes, ...additionalAttributes};

                    let viewName = this.getMetadata()
                        .get(['clientDefs', foreignScope, 'modalViews', 'edit']) || 'views/modals/edit';

                    this.createView('quickCreate', viewName, {
                        scope: foreignScope,
                        relate: {
                            model: this.model,
                            link: foreignLink,
                        },
                        attributes: attributes,
                    }, view => {
                        view.render();
                        view.notify(false);

                        this.listenToOnce(view, 'after:save', () => {
                            this.collection.fetch();

                            this.model.trigger('after:relate');
                            this.model.trigger('after:relate:' + link);
                        });
                    });
                });
        },

        /**
         * An `unlink-related` action.
         *
         * @protected
         */
        actionUnlinkRelated: function (data) {
            let id = data.id;

            this.confirm({
                message: this.translate('unlinkRecordConfirmation', 'messages'),
                confirmText: this.translate('Unlink'),
            }, () => {
                Espo.Ui.notify(' ... ');

                Espo.Ajax
                    .deleteRequest(this.collection.url, {id: id})
                    .then(() => {
                        this.notify('Unlinked', 'success');

                        this.collection.fetch();

                        this.model.trigger('after:unrelate');
                        this.model.trigger('after:unrelate:' + this.link);
                    });
            });
        },

        /**
         * @inheritDoc
         */
        getHeader: function () {
            let name = this.model.get('name') || this.model.id;

            let recordUrl = '#' + this.scope  + '/view/' + this.model.id;

            let $name =
                $('<a>')
                    .attr('href', recordUrl)
                    .addClass('font-size-flexible title')
                    .text(name);

            if (this.model.get('deleted')) {
                $name.css('text-decoration', 'line-through');
            }

            let headerIconHtml = this.getHelper().getScopeColorIconHtml(this.foreignScope);
            let scopeLabel = this.getLanguage().translate(this.scope, 'scopeNamesPlural');

            let $root = $('<span>').text(scopeLabel);

            if (!this.rootLinkDisabled) {
                $root = $('<span>')
                    .append(
                        $('<a>')
                            .attr('href', '#' + this.scope)
                            .addClass('action')
                            .attr('data-action', 'navigateToRoot')
                            .text(scopeLabel)
                    );
            }

            if (headerIconHtml) {
                $root.prepend(headerIconHtml);
            }

            let $link = $('<span>').text(this.translate(this.link, 'links', this.scope));

            return this.buildHeaderHtml([
                $root,
                $name,
                $link
            ]);
        },

        /**
         * @inheritDoc
         */
        updatePageTitle: function () {
            this.setPageTitle(this.getLanguage().translate(this.link, 'links', this.scope));
        },

        /**
         * Create attributes for an entity being created.
         *
         * @return {Object}
         */
        getCreateAttributes: function () {},

        /**
         * @protected
         * @param {JQueryKeyEventObject} e
         */
        handleShortcutKeyCtrlSpace: function (e) {
            if (!this.createButton) {
                return;
            }

            if (!this.getAcl().checkScope(this.foreignScope, 'create')) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();


            this.actionQuickCreate({focusForCreate: true});
        },

        /**
         * @protected
         * @param {JQueryKeyEventObject} e
         */
        handleShortcutKeyCtrlSlash: function (e) {
            if (!this.searchPanel) {
                return;
            }

            let $search = this.$el.find('input.text-filter').first();

            if (!$search.length) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            $search.focus();
        },

        /**
         * @protected
         * @param {JQueryKeyEventObject} e
         */
        handleShortcutKeyCtrlComma: function (e) {
            if (!this.getSearchView()) {
                return;
            }

            this.getSearchView().selectPreviousPreset();
        },

        /**
         * @protected
         * @param {JQueryKeyEventObject} e
         */
        handleShortcutKeyCtrlPeriod: function (e) {
            if (!this.getSearchView()) {
                return;
            }

            this.getSearchView().selectNextPreset();
        },
    });
});
