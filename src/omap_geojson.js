import View from 'ol/View';
import {fromLonLat, toLonLat} from 'ol/proj';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import LayerGroup from 'ol/layer/Group';
import Map from 'ol/Map';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import Icon from 'ol/style/Icon';
import Text from 'ol/style/Text';
import Style from 'ol/style/Style';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import LayerSwitcher from 'ol-layerswitcher';
import Popup from 'ol-popup';

const param = {
  lon: 138.9853, lat: 36.5039, zoom: 10
};

let current_zoom;

const view = new View({
  center: fromLonLat([param.lon, param.lat]),
  zoom: param.zoom,
  minZoom: 2,
  maxZoom: 18,
  constrainResolution: true
});

const std = new TileLayer({
  source: new XYZ({
    attributions: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'
  }),
  title: '標準',
  type: 'base'
});
const pale = new TileLayer({
  source: new XYZ({
    attributions: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'
  }),
  title: '淡色',
  type: 'base',
  visible: false
});
const seamlessphoto = new TileLayer({
  source: new XYZ({
    attributions: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'
  }),
  title: '写真',
  type: 'base',
  visible: false
});
const bases = new LayerGroup({
  layers: [seamlessphoto, pale, std],
  title: '地図の種類'
});
const map = new Map({
  target: 'map',
  layers: [bases],
  view: view
});

const fill = new Fill({ color: 'blue' });
const stroke = new Stroke({ color: 'white', width: 2 });
const img_w = new Icon({ src: 'https://map.jpn.org/icon/902029.png', declutterMode: 'none' });
const img_r = new Icon({ src: 'https://map.jpn.org/icon/902030.png', declutterMode: 'none' });
const img_y = new Icon({ src: 'https://map.jpn.org/icon/902031.png', declutterMode: 'none' });
// zmin           8,     9,    10,    11,    12,    13
const img = [ img_r, img_r, img_r, img_r, img_y, img_w ];

function styleFunction(feature) {
  let style;
  const type = feature.getGeometry().getType();
  const zmin = feature.get('zmin');
  if (current_zoom < zmin) {
    return null;
  }
  if (type === 'Point') {
    style = {
      image: img[zmin - 8],
      text: new Text({
        text: feature.get('name'),
        font: '14px sans-serif',
        fill: fill,
        stroke: stroke,
        textAlign: 'left',
        offsetX: 12,
        offsetY: 3
      }),
      zIndex: feature.get('alt')
    };
  }
  return new Style(style);
}

const sanmei = new VectorLayer({
  source: new VectorSource({
    url: 'pois.php',
    format: new GeoJSON()
  }),
  style: styleFunction,
  declutter: true
});
const data = new LayerGroup({
  layers: [sanmei],
  title: '山名'
});
map.addLayer(data);
map.addControl(new LayerSwitcher());

function todms(deg) {
  const ss = Math.round(deg * 3600);
  const d = Math.floor(ss / 3600);
  const m = ('0' + Math.floor((ss % 3600) / 60)).substr(-2);
  const s = ('0' + ss % 60).substr(-2);
  return d + '°' + m + '′' + s + '″';
}

function getHTML(feature) {
  const lonlat = toLonLat(feature.getGeometry().getCoordinates());
  return '<h2>' + feature.get('name')
    + '</h2><table><tbody><tr><td>よみ</td><td>' + feature.get('kana')
    + '</td></tr><tr><td>標高</td><td>' + feature.get('alt')
    + 'm</td></tr><tr><td>緯度</td><td>' + todms(lonlat[0])
    + '</td></tr><tr><td>経度</td><td>' + todms(lonlat[1])
    + '</td></tr><tr><td>ID</td><td>' + feature.getId()
    + '</td></tr></tbody></table>';
}

const popup = new Popup();
map.addOverlay(popup);
map.on('click', function (evt) {
  let coordinate;
  let html;
  map.forEachFeatureAtPixel(
    evt.pixel,
    function (feature, _layer) {
      const geometry = feature.getGeometry();
      if (geometry.getType() !== 'Point') {
        return false;
      }
      coordinate = geometry.getCoordinates();
      html = getHTML(feature);
      return true;
    }
  );
  popup.show(coordinate, html);
});
map.on('pointermove', function (evt) {
  if (evt.dragging) { return; }
  const found = map.forEachFeatureAtPixel(
    map.getEventPixel(evt.originalEvent),
    function (feature, _layer) {
      return feature.getGeometry().getType() === 'Point';
    }
  );
  map.getTargetElement().style.cursor = found ? 'pointer' : '';
});
map.on('moveend', function (_evt) {
  current_zoom = view.getZoom();
  sanmei.changed();
});
