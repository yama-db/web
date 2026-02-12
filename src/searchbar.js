// searchbar.js
import Control from 'ol/control/Control';

export default class Searchbar extends Control {
  constructor(options = {}) {
    const element = options.element;
    super({ element });
    this.container = element;
    this.container.className = options.className || 'ol-searchbar ol-unselectable';
  }
}
// __END__
