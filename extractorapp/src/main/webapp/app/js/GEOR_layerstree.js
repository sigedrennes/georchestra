/*
 * Copyright (C) Camptocamp
 *
 * This file is part of geOrchestra
 *
 * geOrchestra is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with geOrchestra.  If not, see <http://www.gnu.org/licenses/>.
 */

/*
 * @include GEOR_data.js
 * @include GEOR_ows.js
 * @include GEOR_util.js
 * @include GEOR_waiter.js
 * @include GEOR_config.js
 * @include OpenLayers/Control/SelectFeature.js
 */

Ext.namespace("GEOR");

GEOR.layerstree = (function() {
    /*
     * Private
     */

    /**
     * Property: map
     * {OpenLayers.Map} The map
     */
    var map;

    /**
     * Property: vectorLayer
     * {OpenLayers.Layer.Vector} The vector layer.
     */
    var vectorLayer;

    /**
     * Property: sf
     * {OpenLayers.Control.SelectFeature} The control used to hover the features.
     */
    var sf;

    /**
     * Property: mask
     * {Ext.LoadMask} The treePanel loadMask
     */
    var mask;
    
    /**
     * Property: counter
     * {Integer} An internal ajax request counter
     */
    var counter;

    /**
     * Property: rootNode
     * {Ext.tree.AsyncTreeNode} The root tree node.
     */
    var rootNode;
    
    /**
     * Property: servicesNode
     * {Ext.tree.AsyncTreeNode} The "OGC services" tree node.
     */
    var servicesNode;
    
    /**
     * Property: layersNode
     * {Ext.tree.AsyncTreeNode} The "Single layers" tree node.
     */
    var layersNode;

    /**
     * Property: globalPropertiesNode
     * {Ext.tree.TreeNode} The global properties tree node.
     */
    var globalPropertiesNode;
    
    /**
     * Property: maxLayerNameLength
     * {Integer} maximum number of chars for layer name
     */
    var maxLayerNameLength = 30;

    /**
     * Property: observable
     * {Ext.util.Obervable}
     */
    var observable = new Ext.util.Observable();
    observable.addEvents(
        /**
         * Event: beforelayerchange
         * Fires when a layer selection is about to change
         */
        "beforelayerchange",
        /**
         * Event: layerchange
         * Fires when a layer selection has changed
         */
        "layerchange",
        /**
         * Event: beforeextract
         * Fires before extraction is performed
         */
        "beforeextract",
        /**
         * Event: loaderror
         * Fires each time an error occurs during layer/service check
         */
        "loaderror"
    );

    /**
     * Property: selectionModel
     * {Ext.tree.DefaultSelectionModel} The tree selection model.
     */
    var selectionModel = new Ext.tree.DefaultSelectionModel({
        listeners: {
            'beforeselect': function(sm, newnode, oldnode){
                if(!newnode.isLeaf()) {
                    // only leaf nodes are selectable
                    return false;
                }
                if(oldnode) {
                    //save options in oldnode.attributes.owsinfo
                    var owsinfo = oldnode.attributes.owsinfo;
                    owsinfo.extent = map.getExtent(); // strange ...
                    observable.fireEvent('beforelayerchange');
                    if (sf) {
                        map.removeControl(sf);
                    }
                    // remove layers from map
                    removeAllLayers();
                }
                return true;
            },
            'selectionchange': function(sm, node){
                if(node.isLeaf()) {
                    var owsinfo = node.attributes.owsinfo;
                    if(owsinfo.layer == undefined) {
                        alert("ERREUR: owsinfo.layer devrait être toujours défini");
                        return;
                    }
                    var mapCRS = owsinfo.layer.projection; // FIXME: we might need a better process to find the suitable SRS
                    var baselayerOptions = {
                        projection: mapCRS, 
                        maxExtent: owsinfo.layer.maxExtent.scale(1.5),
                        units: GEOR.util.getUnitsForCRS(mapCRS)
                    };
                    if(owsinfo.baselayer == undefined) {
                        // baselayer has never been created
                        owsinfo.baselayer = GEOR.map.getBaseLayer(baselayerOptions);
                    }
                    if(!owsinfo.extent) {
                        owsinfo.extent = owsinfo.layer.maxExtent;
                    }
                    map.addLayer(owsinfo.baselayer);
                    
                    // At this step, the map maxExtent / projection / units ... is not set to a correct value,
                    //  even though the baselayer has correct params.
                    // That's why we're doing this:
                    map.setOptions(baselayerOptions);
                    // (might be an Openlayers bug - we'll see if things have changed on library update)

                    if (owsinfo.layer.CLASS_NAME != "OpenLayers.Layer") {
                        map.addLayer(owsinfo.layer);
                    }
                    
                    // TODO: find a way to override strategy (a box strategy might be better than a fixed one, 
                    // since the max number of retrievable features is set)

                    // if layer has a strategy then activate it
                    if(owsinfo.layer.strategies && (owsinfo.layer.strategies.length == 1)) {
                        // TODO: show a mask on the layer tree to prevent selecting
                        // another layer before features have been completely loaded
                        // --> listen to loadend strategy event to remove the mask

                        // strategy activation
                        var strategy = owsinfo.layer.strategies[0];
                        strategy.activate();
                    }
                    map.addLayer(vectorLayer);
                    
                    // This is in order to set the vector layer to the SRS of the map:
                    vectorLayer.addOptions({projection: owsinfo.baselayer.projection}); 

                    map.zoomToExtent(owsinfo.extent.scale(1.1));
                    
                    // Hovering features :
                    if (owsinfo.layer.CLASS_NAME == "OpenLayers.Layer.Vector") {
                        sf = new OpenLayers.Control.SelectFeature(owsinfo.layer, {
                            autoActivate: true,
                            hover: true
                        });
                        map.addControl(sf);
                    }
                    observable.fireEvent('layerchange', owsinfo.exportinfo, (node==globalPropertiesNode));
                }
            }
        }
    });


    /**
     * Method: removeAllLayers
     * Remove all layers from OpenLayers map.
     */
    var removeAllLayers = function() {
        if(map && map.layers) {
            while(map.layers.length > 0) {
                map.removeLayer(map.layers[0]);
            }
        }
    };
    
    /**
     * Method: getChecked
     * Retrieve an array of checked nodes, or an array of a specific
     * attribute of checked nodes (e.g. "id")
     *
     * Parameters:
     * startNode - {TreeNode} The node to start from, defaults to the root
     * a - {String} attribute (optional) Defaults to null (return the actual nodes)
     */
    var getChecked = function(startNode, a){
        var r = [];
        var f = function(){
            if(this.attributes.checked && this.isLeaf() && 
                this.attributes.owsinfo) {
                r.push(!a ? this : (a == 'id' ? this.id : this.attributes[a]));
            }
        };
        startNode.cascade(f);
        return r;
    };

    /**
     * Method: appendNodesFromLayerList
     * Create and append layers nodes to layersNode node given
     * a list of layers information.
     *
     * Parameters:
     * layersInfo - {Array} List of layers information.
     * parentNode - {Ext.tree.AsyncTreeNode} The node from which to 
     *      append children nodes.
     */
    var appendNodesFromLayerList = function(layersInfo, parentNode) {
        Ext.each(layersInfo, function(item) {
            if(item.owstype == "WMS") {
                appendNodesFromWMSCap(item, parentNode);
            } else if (item.owstype == "WFS") {
                appendNodesFromWFSCap(item, parentNode);
            }
        });
    };
    
    var checkNullCounter = function() {
        counter -= 1;
        //console.log('compteur décrémenté de 1 -> '+counter);
        if (counter === 0) {
            mask.hide();
        }
    };

    /**
     * Method: appendNodesFromServiceList
     * Create and append layers nodes to servicesNode node given
     * a list of services information.
     *
     * Parameters:
     * servicesInfo - {Array} List of services information.
     * parentNode - {Ext.tree.AsyncTreeNode} The node from which to 
     *      append children nodes.
     */
    var appendNodesFromServiceList = function(servicesInfo, parentNode) {
        var nodeBaseConfig = {
            checked: GEOR.config.LAYERS_CHECKED,
            expanded: true,
            children: [],
            listeners: {"checkchange": checker}
        };
        Ext.each(servicesInfo, function(item, index, allItems) {
            if(item.owstype == "WMS") {
                appendNodesFromWMSCap(item, nodeBaseConfig);
            } else if (item.owstype == "WFS") {
                appendNodesFromWFSCap(item, nodeBaseConfig);
            }
        });
    };
 
    var appendNodesFromWFSCap = function(wfsinfo, node) {
        GEOR.ows.WFSCapabilities({
            storeOptions: {
                url: wfsinfo.owsurl,
                protocolOptions: {
                    maxFeatures: GEOR.config.MAX_FEATURES,
                    srsName: GEOR.config.GLOBAL_EPSG,
                    url: wfsinfo.owsurl
                }
            },
            success: function(store, records) {
                if (!(node instanceof Ext.tree.TreeNode)) {
                    var serviceNode = new Ext.tree.AsyncTreeNode(Ext.apply({
                        text: wfsinfo.text,
                        qtip: "Service WFS <b>"+wfsinfo.text+"</b><br/>"+wfsinfo.owsurl,
                        iconCls: 'wfs-server',
                    }, node));
                    new Ext.tree.TreeSorter(serviceNode, {
                        leafAttr: "leaf",
                        dir: "asc",
                        property: "text",
                        caseSensitive: false
                    });
                    servicesNode.appendChild(serviceNode);
                }
                var appendRecord = function(record) {
                    var owsinfo = {
                        text: record.get("title") || record.get("name"),
                        owstype: wfsinfo.owstype, // WFS
                        owsurl: wfsinfo.owsurl,
                        layer: record.get("layer"),
                        exportinfo: {
                            srs: GEOR.config.GLOBAL_EPSG,
                            bbox: GEOR.config.GLOBAL_MAX_EXTENT,
                            owsType: wfsinfo.owstype, // WFS
                            owsUrl: wfsinfo.owsurl,
                            layerName: record.get("name"),
                            namespace: record.get("namespace")
                        }
                    };
                    // remove autoActivation of the strategy to prevent the refresh
                    // on adding the layer to the map
                    owsinfo.layer.strategies[0].autoActivate = false;
                    owsinfo.layer.addOptions({
                        alwaysInRange: true,
                        opacity: 0.7,
                        projection: GEOR.config.GLOBAL_EPSG,
                        maxExtent: GEOR.config.GLOBAL_MAX_EXTENT
                    });
                    owsinfo.layer.events.register("featuresadded", {}, function(evt) {
                        if(evt.features.length == GEOR.config.MAX_FEATURES) {
                            GEOR.util.infoDialog({
                                msg: "Le nombre maximal d'objets a été atteint : seulement " +
                                GEOR.config.MAX_FEATURES + " objets sont affichés."
                            });
                        }
                    });
                    
                    if (node instanceof Ext.tree.TreeNode) {
                        appendLayerChild(owsinfo, node);
                    } else {
                        appendLayerChild(owsinfo, serviceNode);
                    }
                };

                if(wfsinfo.layername) {
                    // look for the layername and append it
                    var index = store.findBy(function(record, id) {
                        var splittedName= wfsinfo.layername.split(':');
                        if(record.get("name") == splittedName[splittedName.length-1]) {
                            return true;
                        }
                    });
                    if(index >= 0) {
                        appendRecord(records[index]);
                    } else {
                        layersNode.appendChild(new Ext.tree.TreeNode({
                            text: GEOR.util.shortenLayerName(wfsinfo.layername, maxLayerNameLength),
                            disabled: true,
                            iconCls: 'error-layer',
                            checked: false,
                            qtip: "La couche WFS <b>"+wfsinfo.layername+"</b> n'existe pas sur le service spécifié ("+wfsinfo.owsurl+")",
                            leaf: true
                        }));
                        
                        observable.fireEvent('loaderror', {
                            service: wfsinfo.owsurl,
                            layer: wfsinfo.layername,
                            msg: "Couche non existante"
                        });
                        
                    }
                } else {
                    // append all records
                    store.each(appendRecord);
                }
                checkNullCounter(); // OK
            },
            failure: function() {
                
                var serviceNode = new Ext.tree.AsyncTreeNode(Ext.applyIf({
                    text: wfsinfo.text,
                    iconCls: 'server-error',
                    checked: false,
                    disabled: true,
                    qtip: "Service WFS <b>"+wfsinfo.text+"</b> : non disponible<br/>"+wfsinfo.owsurl,
                }, node));
                servicesNode.appendChild(serviceNode);
                
                var msg = "La requête WFSCapabilities sur "+wfsinfo.owsurl+" n'a pas abouti";
                observable.fireEvent('loaderror', {
                    service: wfsinfo.owsurl,
                    msg: msg
                });
                checkNullCounter(); // OK
            }
        });
    };
    
    /**
     * Method: appendNodesFromWMSCap
     */
    var appendNodesFromWMSCap = function(wmsinfo, node) {
        GEOR.ows.WMSCapabilities({
            storeOptions: {
                url: wmsinfo.owsurl,
                layerOptions: {
                    singleTile: true
                }
            },
            success: function(store, records) {
                var parentNode;
                if (!(node instanceof Ext.tree.TreeNode)) {
                    // create service node and append it to services node
                    var serviceNode = new Ext.tree.AsyncTreeNode(Ext.apply({
                        text: wmsinfo.text,
                        qtip: "Service WMS <b>"+wmsinfo.text+"</b><br/>"+wmsinfo.owsurl,
                        iconCls: 'wms-server',
                    }, node));
                    new Ext.tree.TreeSorter(serviceNode, {
                        leafAttr: "leaf",
                        dir: "asc",
                        property: "text",
                        caseSensitive: false
                    });
                    servicesNode.appendChild(serviceNode);
                    parentNode = serviceNode;
                } else {
                    parentNode = layersNode;
                }
                
                var appendRecord = function(record) {
                    var maxExtent, srs;
                    var bbox = record.get("bbox");
                    for(var p in bbox) {
                        srs = bbox[p].srs;
                        maxExtent = OpenLayers.Bounds.fromArray(bbox[p].bbox);
                        break;
                    }
                    if(!(srs && maxExtent)) {
                        // no bbox found!
                        // we need to build one here...
                        var srslist = record.get("srs");
                        for (var key in srslist) {
                            if (!srslist.hasOwnProperty(key)) {
                                continue;
                            }
                            if (key != "EPSG:WGS84(DD)" && srslist[key] === true) {
                                // bug "EPSG:WGS84(DD)" is not a valid srs
                                // http://jira.codehaus.org/browse/GEOS-3223
                                // don't take such a layer in account
                                srs = key
                                break;
                            }
                        }
                        var llbbox = record.get("llbbox");
                        maxExtent = OpenLayers.Bounds.fromArray(llbbox).transform(
                            new OpenLayers.Projection("EPSG:4326"),
                            new OpenLayers.Projection(srs));
                    }
                    if(!(srs && maxExtent)) {
                        
                        // append error node here
                        parentNode.appendChild(new Ext.tree.TreeNode({
                            text: GEOR.util.shortenLayerName(wmsinfo.layername, maxLayerNameLength),
                            disabled: true,
                            iconCls: 'error-layer',
                            checked: false,
                            qtip: "Impossible de trouver une projection supportée " +
                                 "pour la couche WMS <b>"+wmsinfo.layername+"</b>",
                            leaf: true
                        }));
                        
                        var msg = "Impossible de trouver une projection supportée " +
                                 "pour la couche : " + record.get("title");
                        observable.fireEvent('loaderror', {
                            service: wmsinfo.owsurl,
                            layer: record.get("title"),
                            msg: msg
                        });
                        return;
                    }

                    var owsinfo = {
                        text: record.get("title"),
                        owstype: wmsinfo.owstype, // WMS
                        owsurl: wmsinfo.owsurl,
                        layer: record.get("layer"),
                        exportinfo: {
                            srs: srs,
                            bbox: maxExtent
                        }
                    };
                    owsinfo.layer.addOptions({
                        alwaysInRange: true,
                        opacity: 0.7,
                        projection: srs,
                        maxExtent: maxExtent
                    });
                    if (node instanceof Ext.tree.TreeNode) {
                        appendLayerChild(owsinfo, node);
                    } else {
                        appendLayerChild(owsinfo, serviceNode);
                    }
                };

                // one layer has been given to us, not the whole service
                if(wmsinfo.layername) {
                    // look for the layername and append it
                    var index = store.findBy(function(record, id) {
                        if(record.get("name") == wmsinfo.layername) {
                            return true;
                        }
                    });
                    if(index >= 0) {
                        appendRecord(records[index]);
                    } else {
                        
                        layersNode.appendChild(new Ext.tree.TreeNode({
                            text: GEOR.util.shortenLayerName(wmsinfo.layername, maxLayerNameLength),
                            disabled: true,
                            iconCls: 'error-layer',
                            checked: false,
                            qtip: "La couche WMS <b>"+wmsinfo.layername+"</b> n'existe pas sur le service spécifié ("+wmsinfo.owsurl+")",
                            leaf: true
                        }));
                        
                        observable.fireEvent('loaderror', {
                            service: wmsinfo.owsurl,
                            layer: wmsinfo.layername,
                            msg: "Couche non existante"
                        });

                    }
                } else {
                    // append all records
                    store.each(appendRecord);
                }
                checkNullCounter(); // OK
            },
            failure: function() {
                
                var serviceNode = new Ext.tree.AsyncTreeNode(Ext.applyIf({
                    text: wmsinfo.text,
                    disabled: true,
                    checked: false,
                    iconCls: 'server-error',
                    qtip: "Service WMS <b>"+wmsinfo.text+"</b> : non disponible<br/>"+wmsinfo.owsurl,
                }, node));
                servicesNode.appendChild(serviceNode);
                
                var msg = "La requête WMSCapabilities sur "+wmsinfo.owsurl+" n'a pas abouti";
                observable.fireEvent('loaderror', {
                    service: wmsinfo.owsurl,
                    msg: msg
                });
                checkNullCounter(); // OK
            }
        });
    };
    
    /**
     * Method: appendLayerChild
     * Create and append layer node to the given param node
     * only if WMS DescribeLayer response is not empty.
     *
     * Parameters:
     * owsinfo - {Object} infos from wms.
     * parentNode - {Ext.tree.AsyncTreeNode} The node to append child to.
     */
    var appendLayerChild = function(owsinfo, parentNode) {
        var tip = "Sélectionnez la couche pour la visualiser "+
            "et configurer ses paramètres d'extraction spécifiques.<br/>"+
            "Cochez la case pour ajouter la couche au panier d'extraction. "+
            "Décochez la case pour retirer la couche du panier.";
        if(owsinfo.owstype == "WMS") {
            counter += 1; // une requete XHR (a) en plus est necessaire (WMSDescribeLayer)
            //console.log('compteur incrémenté de 1 (a) -> '+counter);
            
            // NOTE for the future: do not query N times the same server with the same request
            // keep a local db of responses :-)
            // see http://csm-bretagne.fr/redmine/issues/1928
            GEOR.ows.WMSDescribeLayer(
                owsinfo.layer.params.LAYERS,
                {
                    storeOptions: {
                        url: owsinfo.owsurl
                    },
                    success: function(store, records) {
                        if(owsinfo.exportinfo == undefined) {
                            owsinfo.exportinfo = {};
                        }
                        if(records.length == 0) {
                            
                            parentNode.appendChild(new Ext.tree.TreeNode({
                                text: GEOR.util.shortenLayerName(owsinfo.text, maxLayerNameLength),
                                disabled: true,
                                iconCls: 'error-layer',
                                checked: false,
                                qtip: "La couche <b>"+owsinfo.text+"</b> n'est pas disponible : aucun service d'extraction",
                                leaf: true
                            }));
                            
                            observable.fireEvent('loaderror', {
                                service: owsinfo.owsurl,
                                layer: owsinfo.text,
                                msg: "Aucun service d'extraction."
                            });

                            checkNullCounter(); // XHR (a)
                            return;
                        }
                        owsinfo.exportinfo.owsType = records[0].get("owsType");
                        owsinfo.exportinfo.owsUrl = records[0].get("owsURL");
                        owsinfo.exportinfo.layerName = records[0].get("layerName");
                        owsinfo.exportinfo.layerType = records[0].get("layerType");

                        if (!(((owsinfo.exportinfo.owsType == "WFS") ||
                            (owsinfo.exportinfo.owsType == "WCS")) &&
                            owsinfo.exportinfo.owsUrl)) {

                            parentNode.appendChild(new Ext.tree.TreeNode({
                                text: GEOR.util.shortenLayerName(owsinfo.text, maxLayerNameLength),
                                disabled: true,
                                iconCls: 'error-layer',
                                checked: false,
                                qtip: "La couche <b>"+owsinfo.text+"</b> n'est pas disponible : aucun service d'extraction convenable",
                                leaf: true
                            }));
                                
                            observable.fireEvent('loaderror', {
                                service: owsinfo.owsurl,
                                layer: owsinfo.text,
                                msg: "Aucun service d'extraction convenable."
                            });
                            
                            checkNullCounter(); // XHR (a)
                            return;
                        }
                        
                        if (owsinfo.exportinfo.owsType == 'WCS') {
                            parentNode.appendChild(
                                new Ext.tree.TreeNode({
                                    text: GEOR.util.shortenLayerName(owsinfo.text, maxLayerNameLength),
                                    iconCls: 'raster-layer',
                                    owsinfo: owsinfo,
                                    checked: GEOR.config.LAYERS_CHECKED,
                                    qtip: '<b>'+owsinfo.text+'</b><br/>' + tip,
                                    leaf: true
                                })
                            );
                        } else {
                            /////////////////////////////////////////////////////////////////////
                            // Hack to overcome a geoserver bug: DescribeLayer request always
                            // returns WFS (even when the service should be WCS).
                            // See: https://jira.codehaus.org/browse/GEOS-2631
                            //
                            // The hack performs a "ping" request on the service using a WFS
                            // DescribeFeatureType: if it succeeds, a WFS node is inserted
                            // in the tree (as normal), and if it fails, then it tries to
                            // guess the WCS service url, and insert a WCS node in the tree
                            // only if ping to the new WCS service url succeeds (using a WCS
                            // DescribeCoverage request).
                            /////////////////////////////////////////////////////////////////////
                            counter += 1; // une requete XHR (b) en plus est necessaire (WFSDescribeFeatureType)
                            //console.log('compteur incrémenté de 1 (b) -> '+counter);
                            Ext.Ajax.request({
                                url: GEOR.ows.WFSDescribeFeatureTypeUrl(
                                    owsinfo.exportinfo.owsUrl,
                                    owsinfo.exportinfo.layerName),
                                disableCaching: false,
                                success: function(response) {
                                    parentNode.appendChild(new Ext.tree.TreeNode({
                                        text: GEOR.util.shortenLayerName(owsinfo.text, maxLayerNameLength),
                                        iconCls: 'vector-layer',
                                        owsinfo: owsinfo,
                                        checked: GEOR.config.LAYERS_CHECKED,
                                        qtip: '<b>'+owsinfo.text+'</b><br/>' + tip,
                                        leaf: true
                                    }));
                                    checkNullCounter(); // XHR (b)
                                },
                                failure: function(response) {
                                    var regex = new RegExp("/wfs/WfsDispatcher");
                                    var wcs_url = owsinfo.exportinfo.owsUrl.replace(regex, "/wcs/WcsDispatcher");
                                    var wcs_fullurl = GEOR.ows.WCSDescribeCoverageUrl(wcs_url,owsinfo.exportinfo.layerName);
                                    counter += 1; // une requete XHR (c) en plus est necessaire (WCSDescribeCoverage)
                                    //console.log('compteur incrémenté de 1 (c) -> '+counter);
                                    Ext.Ajax.request({
                                        url: wcs_fullurl,
                                        disableCaching: false,
                                        success: function(response) {
                                            owsinfo.exportinfo.owsUrl = wcs_url;
                                            owsinfo.exportinfo.owsType = "WCS";
                                            parentNode.appendChild(new Ext.tree.TreeNode({
                                                text: GEOR.util.shortenLayerName(owsinfo.text, maxLayerNameLength),
                                                iconCls: 'raster-layer',
                                                owsinfo: owsinfo,
                                                checked: GEOR.config.LAYERS_CHECKED,
                                                qtip: '<b>'+owsinfo.text+'</b><br/>' + tip,
                                                leaf: true
                                            }));
                                            checkNullCounter(); // XHR (c)
                                        },
                                        failure: function(response) {
                                            checkNullCounter();  // XHR (c)
                                            
                                            parentNode.appendChild(new Ext.tree.TreeNode({
                                                text: GEOR.util.shortenLayerName(owsinfo.text, maxLayerNameLength),
                                                disabled: true,
                                                iconCls: 'error-layer',
                                                checked: false,
                                                qtip: "La couche <b>"+owsinfo.text+"</b> n'est pas disponible : lLe service WCS " + wcs_fullurl + " n'est pas valide",
                                                leaf: true
                                            }));
                                            
                                            observable.fireEvent('loaderror', {
                                                service: owsinfo.owsurl,
                                                layer: owsinfo.text,
                                                msg: "Le service WCS " + wcs_fullurl + " n'est pas valide."
                                            });

                                        },
                                        scope: this
                                    });
                                    checkNullCounter(); // XHR (b)
                                },
                                scope: this
                            });
                        }
                        checkNullCounter(); // XHR (a)
                    },
                    failure: function() {
                        checkNullCounter(); // XHR (a)
                        
                        var msg = "La couche <b>"+owsinfo.text+"</b> n'est pas disponible : la requête WMS DescribeLayer sur "+owsinfo.owsurl+" n'a pas abouti.";
                        
                        parentNode.appendChild(new Ext.tree.TreeNode({
                            text: GEOR.util.shortenLayerName(owsinfo.text, maxLayerNameLength),
                            disabled: true,
                            iconCls: 'error-layer',
                            checked: false,
                            qtip: msg,
                            leaf: true
                        }));
                        
                        
                        observable.fireEvent('loaderror', {
                            service: owsinfo.owsurl,
                            layer: owsinfo.text,
                            msg: msg
                        });
                    }
                }
            );
        } else if (owsinfo.owstype == "WFS") {
            parentNode.appendChild(new Ext.tree.TreeNode({
                text: GEOR.util.shortenLayerName(owsinfo.text, maxLayerNameLength),
                iconCls: 'vector-layer',
                owsinfo: owsinfo,
                checked: GEOR.config.LAYERS_CHECKED,
                qtip: '<b>'+owsinfo.text+'</b><br/>' + tip,
                leaf: true
            }));
        }
    };
    
    /**
     * Method: checker
     * Check/uncheck child nodes
     *
     * Parameters:
     * node - {Ext.tree.TreeNode} current tree node
     * checked - {Boolean} new checkbox state
     */
    var checker = function(node, checked) {
        node.cascade(function(n) {
            if (n != node) {
                n.getUI().toggleCheck(checked);
            }
        });
    };


    /*
     * Public
     */

    return {

        /*
         * Observable object
         */
        events: observable,
        
        /**
         * APIMethod: create
         * Return the layers tree config.
         */
        create: function() {
            rootNode = new Ext.tree.TreeNode({
                text: "Votre panier d'extraction",
                expanded: true,
                iconCls: 'basket',
                children: []
            });
            return {
                xtype: 'treepanel',
                root: rootNode,
                autoScroll: true,
                rootVisible: true,
                expanded: true, // mandatory
                loader: {
                    preloadChildren: true
                },
                selModel: selectionModel,
                listeners: {
                    "render": function(p) {
                        (function() {
                            mask = new Ext.LoadMask(p.body.dom, {
                                msg:"chargement..."
                            });
                            mask.show();
                        }).defer(20);
                        // this 20 ms delay is required here because it seems that
                        // the render event is fired too soon by the TreePanel
                    }
                }
            };
        },

        /**
         * APIMethod: init
         * Initialize the layerstree module.
         *
         * Parameters:
         * m - {OpenLayers.Map} The map instance.
         * v - {OpenLayers.Layer.Vector} The vector layer.
         */
        init: function(m, v) {
            map = m;
            vectorLayer = v;

            globalPropertiesNode = new Ext.tree.TreeNode({
                text: "Paramètres par défaut",
                iconCls: 'config-layers',
                qtip: "<b>Paramètres par défaut</b><br/>"+
                    "Ces paramètres sont appliqués à l'extraction de toute couche "+
                    "ne faisant pas l'objet de paramètres spécifiques.",
                leaf: true,
                owsinfo: {
                    layer: new OpenLayers.Layer("fake_layer", { 
                        projection: GEOR.config.GLOBAL_EPSG,
                        maxExtent: GEOR.config.GLOBAL_MAX_EXTENT,
                        maxResolution: "auto",
                        displayInLayerSwitcher: false
                    }),
                    exportinfo: {
                        srs: GEOR.config.GLOBAL_EPSG,
                        bbox: GEOR.config.GLOBAL_MAX_EXTENT
                    }
                }
            });
            
            rootNode.appendChild([globalPropertiesNode]);
            
            if (GEOR.data.layers && GEOR.data.layers.length) {
                layersNode = new Ext.tree.AsyncTreeNode({
                    text: "Couches OGC",
                    checked: GEOR.config.LAYERS_CHECKED,
                    expanded: true, // mandatory
                    qtip: "Couches OGC disponibles pour extraction",
                    children: [],
                    listeners: {
                        "checkchange": checker
                    }
                });
                
                new Ext.tree.TreeSorter(layersNode, {
                    dir: "asc",
                    leafAttr: 'leaf',
                    property: "text",
                    caseSensitive: false
                });
                
                rootNode.appendChild([layersNode]);
            }
            
            if (GEOR.data.services && GEOR.data.services.length) {
                servicesNode = new Ext.tree.AsyncTreeNode({
                    text: "Services OGC",
                    checked: GEOR.config.LAYERS_CHECKED,
                    expanded: true, // mandatory
                    qtip: "Services OGC dont les couches peuvent être extraites",
                    children: [],
                    listeners: {
                        "checkchange": checker
                    }
                });

                rootNode.appendChild([servicesNode]);
            }
            
            
            // we create a counter which will be decreased each time 
            // an XHR request is over / increased when one more is required
            // when it's back to 0, we shall hide the load mask.
            counter = GEOR.data.layers.length + GEOR.data.services.length;
            // at the beginning, we only know that one capabilities request is
            // required for each layer and each service.
            
            //console.log('compteur initial -> '+counter+' ('+
            //  GEOR.data.layers.length+' couches et '+GEOR.data.services.length+' services)');
            
            // create and append layers nodes to layersNode node
            appendNodesFromLayerList(GEOR.data.layers, layersNode);

            // create and append layers nodes to servicesNode node
            appendNodesFromServiceList(GEOR.data.services, servicesNode);

            // default selection is global properties node
            selectionModel.select(globalPropertiesNode);
        },
        
        /**
         * APIMethod: saveExportOptions
         * Save extractOptions in the current node.
         */
        saveExportOptions: function(options) {
            var currentNode = selectionModel.getSelectedNode();
            var owsinfo = currentNode.attributes.owsinfo;
            if(owsinfo.exportinfo == undefined) {
                owsinfo.exportinfo = {};
            }
            Ext.apply(owsinfo.exportinfo, options);
        },
        
        /**
         * APIMethod: extract
         * Extract all checked layers.
         */
        extract: function(email, button) {
            var checkedNodes = getChecked(rootNode), node;
            var l = checkedNodes.length;
            if (l === 0) {
                return;
            }
            
            observable.fireEvent('beforeextract');
            GEOR.waiter.show();
            
            var global = globalPropertiesNode.attributes.owsinfo.exportinfo;
            var out = {
                emails: [email],
                globalProperties: {
                    projection: global.projection,
                    resolution: global.resolution,
                    rasterFormat: global.globalRasterFormat,
                    vectorFormat: global.globalVectorFormat,
                    bbox: {
                        srs: global.srs,
                        value: global.bbox.toArray()
                    }
                },
                layers: new Array(l)
            };
            
            var local;
            for (var i=0; i<l; i++) {
                local = checkedNodes[i].attributes.owsinfo.exportinfo;
                out.layers[i] = {
                    projection: (local.projection && 
                        local.projection.length) ? 
                            local.projection : null,
                    resolution: (typeof(local.resolution) == "number") ?
                        local.resolution : null,
                    format: (local.format && 
                        local.format.length) ? 
                            local.format : null,
                    bbox: (local.bboxFromGlobal !== false) ? null : {
                        srs: local.srs,
                        value: local.bbox.toArray()
                    },
                    owsUrl: local.owsUrl,
                    owsType: local.owsType,
                    layerName: local.layerName,
                    namespace: local.namespace
                };
            }
            
            Ext.Ajax.request({
                url: GEOR.config.EXTRACTOR_BATCH_URL,
                success: function(response) {
                    // disable button
                    button.disable();
                    window.setTimeout(function(){
                        button.enable();
                    }, GEOR.config.EXTRACT_BTN_DISABLE_TIME*1000);
                    // info window
                    GEOR.util.infoDialog({
                        msg: "Extraction en cours.\n" +
                             "Un email vous sera envoyé lorsque l'extraction sera terminée."
                    });
                },
                failure: function(response) {
                    GEOR.util.errorDialog({
                        msg: "La requête d'extraction n'a pas abouti."
                    });
                },
                jsonData: out,
                scope: this
            });

        },
        
        /**
         * APIMethod: getSelectedLayersCount
         * returns the number of selected layers
         */
        getSelectedLayersCount: function() {
            var count = 0;
            rootNode.cascade(function(n) {
                if (n.isLeaf() && n.isSelected() && n.parentNode !== rootNode) {
                    count += 1;
                }
            });
            return count;
        },
        
        /**
         * APIMethod: selectAllLayers
         * check all leaf layers in tree
         *
         * returns the number of checked nodes
         */
        selectAllLayers: function() {
            var count = 0;
            rootNode.cascade(function(n) {
                if (n.isLeaf() && !n.isSelected() && n.parentNode !== rootNode) {
                    count += 1;
                    n.getUI().toggleCheck(true);
                }
            });
            return count;
        }
    };
})();