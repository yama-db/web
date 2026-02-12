// transangle.js

export function toDMS(deg) { // DEG -> DMS
  const sec = parseInt(deg * 3600 + 0.5);
  return [ parseInt(sec / 3600), parseInt((sec % 3600) / 60), sec % 60 ];
}

export function fromDMS(dms) { // DMS -> DEG
  return (Number(dms[2]) / 60 + Number(dms[1])) / 60 + Number(dms[0]);
}

export function fromDigitDMS(s) { // digit -> DMS
  return String(s).match(/^(\d+)(\d\d)(\d\d)$/).slice(1);
}

export function fromDigit(s) { // digit -> DEG
  return fromDMS(fromDigitDMS(s));
}

export function formatDMS(dms) {
  const m = ('0' + dms[1]).slice(-2);
  const s = ('0' + dms[2]).slice(-2);
  return dms[0] + '°' + m + '′' + s + '″';
}

export function formatDEG(deg) {
  return formatDMS(toDMS(deg));
}

export function fromStringYX(s) {
  let ma = s.match(/^(\d+)[,\s]\s*(\d+)$/);
  if (ma) {
    return [fromDigit(ma[2]), fromDigit(ma[1])];
  }
  ma = s.match(/^(\d+\.\d*)[,\s]\s*(\d+\.\d*)$/);
  if (ma) {
    return [Number(ma[2]), Number(ma[1])];
  }
  ma = s.match(/(?:北緯)?\s*(\d+)°\s*(\d+)′\s*(\d+(\.\d*)?)″[,\n]?\s*(?:東経)?\s*(\d+)°\s*(\d+)′\s*(\d+(\.\d*)?)″/)
    || s.match(/(?:北緯)?\s*(\d+)度\s*(\d+)分\s*(\d+(\.\d*)?)秒[,\n]?\s*(?:東経)?\s*(\d+)度\s*(\d+)分\s*(\d+(\.\d*)?)秒/);
  if (ma) {
    return [fromDMS(ma.slice(5, 8)), fromDMS(ma.slice(1, 4))];
  }
  return null;
}

// __END__
