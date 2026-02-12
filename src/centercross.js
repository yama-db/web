// centercross.js
import Control from 'ol/control/Control';

export default class CenterCross extends Control {
  constructor(options = {}) {
    const element = options.element;
    super({ element });
    const img = new Image(24, 24);
    // img.src = './crosshair.gif';
    img.src = 'data:image/gif;base64,R0lGODlhGAAYAPAAAICAgAAAACH5BAEAAAEAIf8LSW1hZ2VNYWdpY2sOZ2FtbWE9MC40NTQ1NDUALAAAAAAYABgAAAIxjI+puwAMk4s0zAovbm9z/4FSJ5Ym4qSpcakq67ZdrJ02WJe5uOOk2fMEN0NM8XYoAAA7';
    element.appendChild(img);
    this.container = element;
    this.container.className = options.className || 'ol-centercross ol-unselectable';
  }

  show() {
    this.container.style.display = 'block';
  }

  hide() {
    this.container.style.display = 'none';
  }
}
// __END__
