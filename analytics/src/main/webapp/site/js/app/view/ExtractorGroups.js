Ext.define('Analytics.view.ExtractorGroups', {
    extend: 'Analytics.view.BaseGridPanel',
    alias: 'widget.extractorgroupslist',
    store: 'ExtractorGroups',
    
    initComponent: function() {
        this.columns = Ext.apply(this.columns || {}, {
            items: [{
                dataIndex: 'company',
                flex: 1, // will be resized
                width: 700, // mandatory with ext 4.1 rc1 (should not be)
                text: 'Organisme'
            }, {
                dataIndex: 'count',
                flex: 0, // will not be resized
                width: 130,
                text: 'Nombre de requêtes'
            }]
        });
        
        this.callParent();
    }
});