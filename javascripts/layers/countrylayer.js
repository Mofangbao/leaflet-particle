/**
 Copyright 2016 Uncharted Software Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */
(function() {
    'use strict';

    var OutlierChart = require('../ui/outlierchart');
    var DateHistogram = require('../ui/datehistogram');
    var Config = require('../config');

    // Reduce counts if on mobile device
    var IS_MOBILE = require('../util/mobile').IS_MOBILE;
    var COUNTRY_COUNT = IS_MOBILE ? Config.country_count * Config.country_mobile_factor : Config.country_count;
    var COUNTRY_COUNT_MIN = IS_MOBILE ? Config.country_count_min * Config.country_mobile_factor : Config.country_count_min;
    var COUNTRY_COUNT_MAX = IS_MOBILE ? Config.country_count_max * Config.country_mobile_factor : Config.country_count_max;

    var CountryLayer = function(spec) {
        this._geoJSONLayer = L.geoJson(null, {
            style: this._getFeatureStyle.bind(this),
            onEachFeature: this._bindClickEvent.bind(this)
        });
        this._redirect = spec.redirect;
        this._click = spec.click;
        this._opacity = 0.2;
        this._histogram = null;
        this._geoJSONMap = {};
        this._colorScale = d3.scale.linear()
            .range(Config.countries_color_ramp) // or use hex values
            .domain([0,1]);
    };

    CountryLayer.prototype = _.extend(CountryLayer.prototype, {

        addTo: function(map) {
            this._map = map;
            this._geoJSONLayer.addTo(map);
            this._$pane = $('#map').find('.leaflet-overlay-pane');
            this.setOpacity(this.getOpacity());
            return this;
        },

        getCountryCountMin: function() {
            return COUNTRY_COUNT_MIN;
        },

        getCountryCountMax: function() {
            return COUNTRY_COUNT_MAX;
        },

        getCountryCount: function() {
            return this._countryCount || COUNTRY_COUNT;
        },

        setCountryCount: function(count) {
            this._countryCount = Math.round(count);
        },

        set : function(histogram) {
            var self = this;
            // store country / count histogram
            this._histogram = histogram;
            // store timestamp of request, if this changes during a batch
            // it will cancel the entire series operation, preventing stale
            // requests
            var currentTimestamp = Date.now();
            this._requestTimestamp = currentTimestamp;
            // update max client count
            this._maxClientCount = _.max( this._histogram );
            // build requests array
            var requests = [];
            _.forEach(this._histogram, function(count,countryCode) {
                if ( count === 0 ) {
                    return;
                }
                if (self._geoJSONMap[countryCode]) {
                    // we already have the geoJSON
                    requests.push( function(done) {
                        self._render(countryCode);
                        done(self._requestTimestamp !== currentTimestamp);
                    });
                } else {
                    // request geoJSON from server
                    requests.push( function(done) {
                        var request = {
                            url: '/geo/' + countryCode,
                            type: 'GET',
                            contentType: 'application/json; charset=utf-8',
                            async: true
                        };
                        $.ajax(request)
                            .done(function(geoJSON) {
                                self._geoJSONMap[countryCode] = geoJSON;
                                self._render(countryCode);
                                done(self._requestTimestamp !== currentTimestamp);
                            })
                            .fail(function(err) {
                                console.log(err);
                                done(self._requestTimestamp !== currentTimestamp);
                            });
                    });
                }
            });
            // execute the requests one at a time to prevent browser from locking
            async.series(requests);
        },

        _render : function(countryCode) {
            var geoJSON = this._geoJSONMap[countryCode];
            if (geoJSON) {
                this._geoJSONLayer.addData(geoJSON);
            }
        },

        _createOutlierChart : function(cc2, cc3) {
            var OUTLIERS_COUNT = IS_MOBILE ? 5 : 10;
            var self = this;
            var request = {
                url: '/outliers/' + cc2 + '/' + OUTLIERS_COUNT,
                type: 'GET',
                contentType: 'application/json; charset=utf-8',
                async: true
            };
            $.ajax(request)
                .done(function(json) {
                    var $container = $('.outlier-chart-container');
                    $container.show();
                    // create chart
                    self._chart = new OutlierChart( $container.find('.chart-content') )
                        .colorStops([Config.connections_color_ramp[1],'rgb(100,100,100)',Config.connections_color_ramp[0]])
                        .title('Guard Client Connection Outliers by Date (' + cc3.toUpperCase() + ')')
                        .click(self._redirect)
                        .updateDate(self._date)
                        .data(json[cc2]);
                })
                .fail(function(err) {
                    console.log(err);
                });
        },

        _createDateHistogram : function(cc2, cc3) {
            var self = this;
            var request = {
                url: '/histogram/' + cc2,
                type: 'GET',
                contentType: 'application/json; charset=utf-8',
                async: true
            };
            $.ajax(request)
                .done(function(histogram) {
                    var $container = $('.date-histogram-container');
                    $container.show();
                    // create chart
                    self._dateHistogram  = new DateHistogram( $container.find('.chart-content') )
                        .colorStops(Config.connections_color_ramp)
                        .title('Guard Client Connections by Date (' + cc3.toUpperCase() + ')')
                        .click(self._redirect)
                        .updateDate(self._date)
                        .data(histogram);
                })
                .fail(function(err) {
                    console.log(err);
                });
        },

        updateDate : function(isoDate) {
            this._date = isoDate;
            if (this._chart) {
                this._chart.updateDate(isoDate);
            }
            if (this._dateHistogram) {
                this._dateHistogram.updateDate(isoDate);
            }
        },

        _bindClickEvent : function(feature, layer) {
            var self = this;
            if (!IS_MOBILE) {
                layer.on({
                    click: function(event) {
                        // execute click func
                        self._click();
                        // grab country codes
                        var feature = event.target.feature;
                        var cc3 = feature.id || feature.properties.ISO_A3;
                        var cc2 = self._threeLetterToTwoLetter(cc3);
                        self._createOutlierChart(cc2, cc3);
                        self._createDateHistogram(cc2, cc3);
                    },
                    mouseover: function() {
                        layer.setStyle(self._getFeatureHoverStyle());
                    },
                    mouseout: function(event) {
                        var feature = event.target.feature;
                        layer.setStyle(self._getFeatureStyle(feature));
                    }
                });
            }
        },

        _threeLetterToTwoLetter : function(cc_threeLetter) {
            var self = this;
            var cc_twoLetter = Object.keys(this._geoJSONMap).filter(function(cc) {
                return self._geoJSONMap[cc] && self._geoJSONMap[cc].cc_3 === cc_threeLetter.toUpperCase();
            });
            if (cc_twoLetter && cc_twoLetter.length) {
                return cc_twoLetter[0];
            } else {
                return null;
            }
        },

        _getFeatureStyle : function(feature) {
            var cc = this._threeLetterToTwoLetter(feature.id || feature.properties.ISO_A3);
            var relativePercentage = this._histogram[cc] / this._maxClientCount;
            var fillColor = this._colorScale(relativePercentage);
            return {
                fillColor: fillColor,
                weight : 0,
                fillOpacity: 1
            };
        },

        _getFeatureHoverStyle : function() {
            return {
                fillColor: '#fff',
                weight : 0,
                fillOpacity: 1
            };
        },

        clear : function() {
            this._geoJSONLayer.clearLayers();
        },

        getOpacity : function() {
            return this._opacity;
        },

        setOpacity: function( opacity ) {
            if (this._opacity !== opacity ||
                this._$pane.css('opacity') !== opacity) {
                this._opacity = opacity;
                if ( this._$pane ) {
                    this._$pane.css('opacity', this._opacity);
                }
            }
        },

        show: function() {
            this._hidden = false;
            if ( this._$pane ) {
                this._$pane.css('display', '');
            }
        },

        hide: function() {
            this._hidden = true;
            if ( this._$pane ) {
                this._$pane.css('display', 'none');
            }
        },

        isHidden: function() {
            return this._hidden;
        }

    });
    module.exports = CountryLayer;

}());
