// omap.js
import View from 'ol/View';
import {fromLonLat, toLonLat} from 'ol/proj';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import Map from 'ol/Map';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import Icon from 'ol/style/Icon';
import Text from 'ol/style/Text';
import Style from 'ol/style/Style';
import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import GeoJSON from 'ol/format/GeoJSON';
import Zoom from 'ol/control/Zoom';
import ScaleLine from 'ol/control/ScaleLine';
import Popup from 'ol-popup';

import CenterCross from './centercross.js';
import Toolbar from './toolbar.js';
import Searchbar from './searchbar.js';
import {fromStringYX} from './transangle.js';

// const api_base = 'https://map.jpn.org';
const api_base = '/~tad/test';

const param = { lon: 138.9853, lat: 36.5039, zoom: 10 };

for (const key in param) {
  param[key] = localStorage.getItem(key) ?? param[key];
}
for (const arg of location.search.slice(1).split('&')) {
  const s = arg.split('=');
  if (s[0] in param) {
    param[s[0]] = Number(s[1]);
  }
}

const view = new View({
  center: fromLonLat([param.lon, param.lat]),
  zoom: param.zoom,
  minZoom: 2,
  maxZoom: 18,
  constrainResolution: true
});

const attributions = [
  '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>'
];

const std = new TileLayer({
  source: new XYZ({
    attributions,
    url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'
  }),
  title: '標準',
  type: 'base'
});

const pale = new TileLayer({
  source: new XYZ({
    attributions,
    url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'
  }),
  title: '淡色',
  type: 'base',
  visible: false
});

const seamlessphoto = new TileLayer({
  source: new XYZ({
    attributions,
    url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'
  }),
  title: '写真',
  type: 'base',
  visible: false
});

let current_zoom = view.getZoom();

const fill = new Fill({ color: 'blue' });
const stroke = new Stroke({ color: 'white', width: 2 });
const img_w = new Icon({ src: 'https://map.jpn.org/icon/902029.png', declutterMode: 'none' });
const img_r = new Icon({ src: 'https://map.jpn.org/icon/902030.png', declutterMode: 'none' });
const img_y = new Icon({ src: 'https://map.jpn.org/icon/902031.png', declutterMode: 'none' });
// z_min          8,     9,    10,    11,    12,    13
const img = [ img_r, img_r, img_r, img_r, img_y, img_w ];

function styleFunction(feature) {
  let style;
  const type = feature.getGeometry().getType();
  const z_min = feature.get('z_min');
  if (current_zoom < z_min) {
    return null;
  }
  if (type === 'Point') {
    style = {
      image: img[z_min - 8],
      text: new Text({
        text: feature.get('name'),
        font: '14px sans-serif',
        fill: fill,
        stroke: stroke,
        textAlign: 'left',
        offsetX: 12,
        offsetY: 3
      }),
      zIndex: feature.get('elev')
    };
  }
  return new Style(style);
}

const sanmei = new VectorTileLayer({
  source: new VectorTileSource({
    url: api_base + '/api/mountains/xyz/{z}/{x}/{y}.geojson',
    format: new GeoJSON()
  }),
  style: styleFunction,
  declutter: true
});

const zoom = new Zoom();
const scaleLine = new ScaleLine();
const centercross = new CenterCross({ element: document.getElementById('centercross') });
const toolbar = new Toolbar({ element: document.getElementById('toolbar') });
const searchbar = new Searchbar({ element: document.getElementById('searchbar') });
const popup = new Popup({ autoPan: false });

const map = new Map({
  target: 'map',
  layers: [ std, pale, seamlessphoto, sanmei ],
  view,
  controls: [zoom, scaleLine, centercross, toolbar, searchbar],
  overlays: [popup]
});

const passive = { passive: true };

const menu2 = document.getElementById('menu2');
toolbar.setToggleButton('tb_menu2', menu2);

toolbar.setPopup(popup);
toolbar.setCenterButton('tb_center');
toolbar.setBaseSelect('tb_base');
toolbar.setZoomSelect('tb_zoom', (zoom) => {
  view.setZoom(zoom);
  current_zoom = zoom;
  sanmei.getSource().changed();
});
toolbar.setCreditButton('tb_help', 'help.html');
toolbar.setLayerCheckbox('tb_sanmei', sanmei);
toolbar.setControlCheckbox('tb_cross', centercross);

const result = document.getElementById('result');
document.getElementById('tb_result').addEventListener('click', function (_event) {
  result.style.display = result.style.display != 'none' ? 'none' : 'block';
});

const count = document.getElementById('count');
const items = document.getElementById('items');
let data_for_save = null;

function displaySanmei(parent, name, kana) {
  const ruby = document.createElement('ruby');
  const rt = document.createElement('rt');
  rt.textContent = kana;
  const m = name.match(/^(?:(.+?)(（.+?）)|(（.+?）)(.+?))$/);
  if (m && m[1]) {
    ruby.textContent = m[1];
    ruby.appendChild(rt);
    parent.appendChild(ruby);
    parent.appendChild(document.createTextNode(m[2]));
  } else if (m && m[3]) {
    parent.appendChild(document.createTextNode(m[3]));
    ruby.textContent = m[4];
    ruby.appendChild(rt);
    parent.appendChild(ruby);
  } else {
    ruby.textContent = name;
    ruby.appendChild(rt);
    parent.appendChild(ruby);
  }
}

function displayResults(data) {
  data_for_save = data;
  while (items.firstChild) {
    items.removeChild(items.firstChild);
  }
  count.textContent = data.length + '件';
  data.forEach(function (item) {
    const tr = document.createElement('tr'); // new row
    const c1 = document.createElement('td'); // 1st column
    c1.textContent = item.id;
    c1.addEventListener('click', function (_event) {
      const coordinate = fromLonLat([ item.lon, item.lat ]);
      view.setCenter(coordinate);
      if (view.getZoom() < 13) {
        view.setZoom(13);
      }
    }, passive);
    tr.appendChild(c1);

    const c2 = document.createElement('td'); // 2nd column
    displaySanmei(c2, item.name, item.kana);
    tr.appendChild(c2);

    const c3 = document.createElement('td'); // 3rd column
    c3.textContent = item.elev;
    tr.appendChild(c3);
    items.appendChild(tr);
  });
}

async function query(s) {
  try {
    const response = await fetch(api_base + '/api/mountains/search?q=' + encodeURIComponent(s));
    if (!response.ok) {
      throw new Error(`HTTPエラー: ${response.status}`);
    }
    const data = await response.json();
    displayResults(data);
  } catch (error) {
    console.error('データの取得に失敗しました:', error);
  }
}

document.forms.form1.addEventListener('submit', function (event) {
  const s = event.target.elements.query.value;
  const lon_lat = fromStringYX(s);
  if (lon_lat) {
    view.setCenter(fromLonLat(lon_lat));
  } else {
    count.textContent = '検索中';
    result.style.display = 'block';
    query(s);
  }
  event.preventDefault();
});

document.forms.form2.addEventListener('submit', function (event) {
  const csv = (event.target.elements.bom.checked ? '\uFEFF' : '')
    + 'ID,山名,よみ,標高,緯度,経度,備考\n'
    + data_for_save.map(x => [ x.id, x.name, x.kana, x.elev, x.lat, x.lon, '' ].join()).join('\n')
    + '\n';
  const b = new Blob([ csv ], { type: 'text/csv;charset=UTF-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'result.csv';
  a.click();
  event.preventDefault();
});

function todms(deg) {
  const ss = Math.round(deg * 3600);
  const d = Math.floor(ss / 3600);
  const m = ('0' + Math.floor((ss % 3600) / 60)).slice(-2);
  const s = ('0' + ss % 60).slice(-2);
  return d + '°' + m + '′' + s + '″';
}

async function getMountainDetail(id) {
  try {
      const response = await fetch(api_base + '/api/mountains/' + id);
      if (!response.ok) {
          throw new Error(`HTTPエラー: ${response.status}`);
      }
      const data = await response.json();
      displayMountainInfo(data);
  } catch (error) {
      console.error('データの取得に失敗しました:', error);
  }
}

function displayMountainInfo(data) {
  const tbody = document.getElementById('mountain-info');
  tbody.replaceChildren();
  const fields = [
    { label: 'よみ', value: data.kana },
    { label: '山域', value: data.parent },
    { label: '別名', value: data.aliases },
    { label: '点名', value: data.gcp_name },
    { label: '標高', value: data.elev + ' m' },
    { label: '緯度', value: todms(data.lat) },
    { label: '経度', value: todms(data.lon) },
    { label: '所在', value: data.address.map(x => x.full_name).join('\n') },
    { label: '出典', value: data.auth },
    { label: 'ID', value: data.id }
  ];
  fields.forEach(function (field) {
    if (field.label === '山域' && field.value.length == 0) {
      return;
    }
    if (field.label === '別名' && field.value.length == 0) {
      return;
    }
    if (field.label === '点名' && !field.value) {
      return;
    }
    const tr = document.createElement('tr');
    const c1 = document.createElement('td');
    c1.textContent = field.label;
    tr.appendChild(c1);
    const c2 = document.createElement('td');
    if (field.label === '山域' || field.label === '別名') {
      field.value.forEach(function (item, index) {
        if (index > 0) {
          c2.appendChild(document.createElement('br'));
        }
        displaySanmei(c2, item.name, item.kana);
      });
    } else {
      c2.textContent = field.value;
    }
    tr.appendChild(c2);
    tbody.appendChild(tr);
  });
}

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
      getMountainDetail(feature.getId());
      coordinate = geometry.getCoordinates();
      html = '<h2>'
        + feature.get('name')
        + '</h2><table><tbody id="mountain-info"><tr><td>読み込み中</td></tr></tbody></table>';
      return true;
    }
  );
  popup.show(coordinate, html);
}, passive);

map.on('pointermove', function (evt) {
  if (evt.dragging) { return; }
  const found = map.forEachFeatureAtPixel(
    map.getEventPixel(evt.originalEvent),
    function (feature, _layer) {
      return feature.getGeometry().getType() === 'Point';
    }
  );
  map.getTargetElement().style.cursor = found ? 'pointer' : '';
}, passive);

map.on('moveend', function (_evt) {
  current_zoom = view.getZoom();
  sanmei.changed();
}, passive);

const tb_exit = document.getElementById('tb_exit');

window.addEventListener('DOMContentLoaded', function (_event) {
  let text, handler;
  if (window.opener) {
    text = '✖︎';
    handler = () => window.close();
  } else if (history.length > 1) {
    text = '戻る';
    handler = () => history.back();
  } else {
    text = 'TOP';
    handler = () => location.assign('.');
  }
  tb_exit.innerText = text;
  tb_exit.addEventListener('click', handler, passive);
}, passive);

window.addEventListener('beforeunload', function (_event) {
  const lon_lat = toLonLat(view.getCenter());
  param.lon = lon_lat[0].toFixed(6);
  param.lat = lon_lat[1].toFixed(6);
  param.zoom = view.getZoom();
  for (const key in param) {
    localStorage.setItem(key, param[key]);
  }
}, passive);
// __END__
