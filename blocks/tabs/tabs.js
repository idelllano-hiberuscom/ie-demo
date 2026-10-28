/**
 * Tabs Block — AEM Edge Delivery Services
 *
 * Contract: EDS-COMP-012 (.eds-pipeline/contracts/tabs.md)
 * Base: Adobe Block Collection (tabs) @ commit 5ad878ba, adapted: one cell per field
 *   (title, heading, subtitle, video, richtext), YouTube video instead of the image (DH-10),
 *   WAI-ARIA APG keyboard support and the collapsible tab list measured on the portal.
 * Model: xwalk (EDS + Universal Editor)
 * UE instrumentation: Completado (Fase 3)
 * QA audit: Validado (Fase 3)
 *
 * QA Changes:
 * - Placeholders keyed as written and in camelCase (toCamelCase lowercases camelCase keys,
 *   tabsToggle -> tabstoggle); the block keys are camelCase: tabsToggle, playVideo, video,
 *   tabsTab (playVideo and video are shared with hero and media-text).
 * - The video field keeps its own node (the URL paragraph, hidden): the instrumentation no
 *   longer lands on the player facade, which Universal Editor would make editable as text.
 * - The tab label (title field) lives in the tab list, outside its item: it carries the
 *   resource of its item so Universal Editor saves it in the right component.
 * - Fallback data-aue-* only when AEM has not instrumented the block (local drafts, preview),
 *   never over the attributes AEM delivers; one resource per block, also inside fragments.
 * - Selecting in Universal Editor an item, or a field of it, that is in a hidden panel
 *   activates its tab (aue:ui-select).
 * - The thumbnail of the active tab is the LCP candidate when the block starts in the first
 *   viewport: eager and high priority instead of lazy.
 */

import { toCamelCase } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

/** Rule DH-10: watch, youtu.be, embed or thumbnail (img.youtube.com/vi/<id>/…) URLs. */
const YOUTUBE_ID_PATTERN = /(?:vi\/|embed\/|v=|youtu\.be\/)([\w-]{11})/;

/** YouTube host of the player. */
const VIDEO_ORIGIN = 'https://www.youtube-nocookie.com';

/** The player starts on the user's click, with YouTube's own controls (not a background video). */
const VIDEO_PARAMS = 'autoplay=1&rel=0&playsinline=1';

/** Thumbnail host; maxresdefault is not generated for every video, hqdefault always is. */
const THUMBNAIL_ORIGIN = 'https://i.ytimg.com/vi';
const THUMBNAIL_WEBP_ORIGIN = 'https://i.ytimg.com/vi_webp';

/** Width YouTube serves when a thumbnail size does not exist (a grey placeholder). */
const MISSING_THUMBNAIL_WIDTH = 120;

/** One cell per field of the tabs-item model, in model order (contract §3b). */
const CELL = {
  title: 0,
  heading: 1,
  subtitle: 2,
  video: 3,
  richtext: 4,
};

/**
 * Fixed texts painted by the block. The site text lives in /placeholders.json
 * (keys tabsToggle, playVideo, video, tabsTab); these English values are the fallback
 * when a key is missing.
 */
const DEFAULT_LABELS = {
  tabsToggle: 'Show all tabs',
  playVideo: 'Play video',
  video: 'Video',
  tabsTab: 'Tab',
};

/** Universal Editor labels of the fallback instrumentation (fields of _tabs.json). */
const UE_LABELS = {
  block: 'Pestañas',
  item: 'Pestaña',
  title: 'Etiqueta de la pestaña',
  heading: 'Titular',
  subtitle: 'Subtítulo',
  video: 'Vídeo (URL de YouTube)',
  richtext: 'Texto',
};

/** data-aue-type of each field of the tabs-item model. */
const FIELD_TYPES = {
  title: 'text',
  heading: 'text',
  subtitle: 'text',
  video: 'text',
  richtext: 'richtext',
};

/** Tabs (horizontal list) from this width; below it the list collapses (contract §2). */
const TABS_LAYOUT_QUERY = '(width >= 1024px)';

const SVG_NS = 'http://www.w3.org/2000/svg';

let blockCount = 0;
let placeholdersRequest;

/**
 * Fetches the site placeholders once (/placeholders.json, rows Key/Text) and returns
 * them keyed both as written and in camelCase: toCamelCase lowercases camelCase keys
 * (tabsToggle -> tabstoggle), so the raw key must stay readable.
 * Any failure resolves to an empty object.
 * @returns {Promise<Object<string, string>>} placeholders
 */
function fetchPlaceholders() {
  if (!placeholdersRequest) {
    placeholdersRequest = fetch('/placeholders.json')
      .then((response) => (response.ok ? response.json() : {}))
      .then((json) => Object.fromEntries((json.data || [])
        .filter((row) => row.Key && row.Text)
        // [QA] [ANTES] .map((row) => [toCamelCase(row.Key), row.Text]): tabsToggle was only
        // readable as "tabstoggle" and the English fallback always won.
        .flatMap((row) => [[toCamelCase(row.Key), row.Text], [row.Key, row.Text]])))
      .catch(() => ({}));
  }
  return placeholdersRequest;
}

/**
 * @param {?Element} cell cell of the item
 * @returns {boolean} true when the author filled the field
 */
function hasContent(cell) {
  return Boolean(cell && (cell.textContent.trim() || cell.querySelector('picture, img, a')));
}

/**
 * Moves the instrumentation of a cell, and of the paragraph AEM renders inside it, to the
 * element that now shows its content.
 * @param {Element} cell cell of the item
 * @param {?Element} source paragraph inside the cell
 * @param {Element} target element that receives the content
 */
function moveCellInstrumentation(cell, source, target) {
  moveInstrumentation(cell, target);
  if (source && source !== cell) moveInstrumentation(source, target);
}

/**
 * @param {Element} cell video cell
 * @returns {string|null} the YouTube id written by the author, as a link or as text
 */
function readVideoId(cell) {
  const link = cell.querySelector('a[href]');
  const value = link ? link.href : cell.textContent.trim();
  const match = value.match(YOUTUBE_ID_PATTERN);
  return match ? match[1] : null;
}

/**
 * Builds a decorative SVG icon drawn with the current text colour.
 * @param {string} viewBox viewBox of the icon
 * @param {string[]} paths path data
 * @returns {SVGSVGElement} the icon
 */
function buildIcon(viewBox, paths) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  paths.forEach((d) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  });
  return svg;
}

/**
 * Turns the heading cell into an h3 (the section heading above the block is an h2).
 * @param {Element} cell heading cell
 * @returns {HTMLHeadingElement} the heading
 */
function decorateHeading(cell) {
  const source = cell.querySelector('h1, h2, h3, h4, h5, h6, p') || cell;
  const heading = document.createElement('h3');
  heading.className = 'tabs-heading';
  heading.append(...source.childNodes);
  moveCellInstrumentation(cell, source, heading);
  cell.remove();
  return heading;
}

/**
 * Keeps the authored subtitle paragraph (italic by CSS).
 * @param {Element} cell subtitle cell
 * @returns {Element} the subtitle paragraph
 */
function decorateSubtitle(cell) {
  let paragraph = cell.querySelector('p');
  if (!paragraph) {
    paragraph = document.createElement('p');
    paragraph.append(...cell.childNodes);
  }
  paragraph.classList.add('tabs-subtitle');
  moveInstrumentation(cell, paragraph);
  cell.remove();
  return paragraph;
}

/**
 * Turns the video cell into a lightweight player: the YouTube thumbnail and a play button.
 * Nothing from YouTube but the thumbnail is requested until the user presses play, and
 * the thumbnail itself waits until its panel is shown (lazy image in a hidden panel).
 * The URL the author wrote stays in the cell as a hidden paragraph: it is the node of the
 * video field for Universal Editor, edited from the properties panel.
 * @param {Element} cell video cell
 * @param {string} id YouTube id
 * @param {string} name accessible name of the story (heading or tab label)
 * @param {Object<string, string>} labels fixed texts
 * @returns {{cell: Element, field: Element}} div.tabs-video and the node of the field
 */
function decorateVideo(cell, id, name, labels) {
  // [QA] [ANTES] the instrumentation of the URL paragraph moved to div.tabs-video and the
  // paragraph was removed: Universal Editor would edit the player facade as plain text.
  let field = cell.querySelector('p');
  if (!field) {
    field = document.createElement('p');
    field.append(...cell.childNodes);
    cell.append(field);
  }
  moveInstrumentation(cell, field);
  field.hidden = true;
  cell.className = 'tabs-video';
  cell.dataset.videoId = id;
  cell.dataset.videoName = name;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tabs-video-play';
  button.setAttribute('aria-label', name ? `${labels.playVideo}: ${name}` : labels.playVideo);

  const picture = document.createElement('picture');
  const webp = document.createElement('source');
  webp.type = 'image/webp';
  webp.srcset = `${THUMBNAIL_WEBP_ORIGIN}/${id}/maxresdefault.webp`;
  const thumbnail = document.createElement('img');
  thumbnail.src = `${THUMBNAIL_ORIGIN}/${id}/maxresdefault.jpg`;
  thumbnail.alt = '';
  thumbnail.width = 1280;
  thumbnail.height = 720;
  thumbnail.loading = 'lazy';
  thumbnail.decoding = 'async';
  thumbnail.addEventListener('load', () => {
    if (thumbnail.naturalWidth <= MISSING_THUMBNAIL_WIDTH) {
      webp.remove();
      thumbnail.src = `${THUMBNAIL_ORIGIN}/${id}/hqdefault.jpg`;
    }
  }, { once: true });
  picture.append(webp, thumbnail);

  // Play icon of the portal: a ring with a triangle, drawn at 64 × 64.
  const icon = buildIcon('0 0 64 64', [
    'M32 5.3a26.7 26.7 0 1 0 0 53.4a26.7 26.7 0 1 0 0-53.4z',
    'M27 23.5v17l14-8.5z',
  ]);

  button.append(picture, icon);
  cell.append(button);
  return { cell, field };
}

/**
 * Loading policy of the thumbnails (contract §6). Hidden panels keep the lazy thumbnail,
 * which the browser does not request until the panel is shown. The thumbnail of the active
 * panel is the LCP candidate when the block starts in the first viewport: eager and high
 * priority. Sections are hidden while they load, so the block starts where the previous
 * section, already shown, ends. Blocks decorated inside a fragment are detached: lazy.
 * @param {Element} block the block
 * @param {Element} panel the active panel
 */
function prioritizeThumbnail(block, panel) {
  const thumbnail = panel.querySelector('.tabs-video-play img');
  // a fragment decorates its own detached <main>, which also matches main > .section
  const section = block.isConnected ? block.closest('main > .section') : null;
  if (!thumbnail || !section) return;
  const previous = section.previousElementSibling;
  const top = (previous || section).getBoundingClientRect()[previous ? 'bottom' : 'top'];
  if (top + window.scrollY >= window.innerHeight) return;
  // [QA] [ANTES] loading=lazy on every thumbnail: the LCP image waited for layout and
  // competed at low priority. [DESPUÉS] the active one loads eagerly, first.
  thumbnail.loading = 'eager';
  thumbnail.fetchPriority = 'high';
  thumbnail.removeAttribute('decoding');
}

/**
 * Builds the video modal of the block (1:1 portal: the video opens over a black veil, not
 * in place). A native <dialog> opened with showModal(); closing it unloads the player.
 * @returns {HTMLDialogElement} the modal
 */
function buildModal() {
  const dialog = document.createElement('dialog');
  dialog.className = 'tabs-modal';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tabs-modal-close';
  close.setAttribute('aria-label', 'Close');
  close.append(buildIcon('0 0 24 24', ['M5 5l14 14', 'M19 5L5 19']));
  close.addEventListener('click', () => dialog.close());

  const frame = document.createElement('div');
  frame.className = 'tabs-modal-frame';
  dialog.append(close, frame);

  // a click on the veil reaches the dialog itself
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    frame.querySelector('iframe')?.remove();
    document.documentElement.style.overflow = '';
  });
  return dialog;
}

/**
 * Opens the player of a video cell in the block modal.
 * @param {Element} cell div.tabs-video
 * @param {HTMLDialogElement} dialog the block modal
 * @param {Object<string, string>} labels fixed texts
 */
function playVideo(cell, dialog, labels) {
  const { videoId, videoName } = cell.dataset;
  if (!videoId || dialog.open) return;

  const iframe = document.createElement('iframe');
  iframe.src = `${VIDEO_ORIGIN}/embed/${videoId}?${VIDEO_PARAMS}`;
  iframe.title = videoName ? `${labels.video}: ${videoName}` : labels.video;
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';

  dialog.setAttribute('aria-label', videoName || labels.video);
  dialog.querySelector('.tabs-modal-frame').append(iframe);
  document.documentElement.style.overflow = 'hidden';
  dialog.showModal();
}

/**
 * Decorates one item: its row becomes the tab panel and its title cell the tab button.
 * @param {Element} row item row
 * @param {number} index position of the item
 * @param {string} prefix unique id prefix of the block
 * @param {Object<string, string>} labels fixed texts
 * @returns {{tab: HTMLButtonElement, panel: Element, fallbackLabel: ?Element,
 *   fields: Object<string, Element>}} the pair and the node of each filled field
 */
function decorateItem(row, index, prefix, labels) {
  const cells = [...row.children];
  const cell = (name) => cells[CELL[name]];
  const tabId = `${prefix}-tab-${index + 1}`;
  const panelId = `${prefix}-panel-${index + 1}`;

  const content = document.createElement('div');
  content.className = 'tabs-content';
  /** Node that shows each field, for the Universal Editor instrumentation. */
  const fields = {};

  let headingText = '';
  if (hasContent(cell('heading'))) {
    fields.heading = decorateHeading(cell('heading'));
    headingText = fields.heading.textContent.trim();
    content.append(fields.heading);
  } else {
    cell('heading')?.remove();
  }
  if (hasContent(cell('subtitle'))) {
    fields.subtitle = decorateSubtitle(cell('subtitle'));
    content.append(fields.subtitle);
  } else {
    cell('subtitle')?.remove();
  }

  // Tab label: the title the author wrote; without it, the heading or "Tab n".
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'tabs-tab';
  tab.id = tabId;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-controls', panelId);
  const label = document.createElement('span');
  let fallbackLabel = null;
  const titleCell = cell('title');
  if (hasContent(titleCell)) {
    const source = titleCell.querySelector('p') || titleCell;
    label.append(...source.childNodes);
    moveCellInstrumentation(titleCell, source, label);
    fields.title = label;
  } else if (headingText) {
    label.textContent = headingText;
  } else {
    label.textContent = `${labels.tabsTab} ${index + 1}`;
    fallbackLabel = label;
  }
  titleCell?.remove();
  tab.append(label);

  const richtext = cell('richtext');
  if (hasContent(richtext)) {
    richtext.className = 'tabs-richtext';
    content.append(richtext);
    fields.richtext = richtext;
  } else {
    richtext?.remove();
  }

  const videoCell = cell('video');
  const videoId = hasContent(videoCell) ? readVideoId(videoCell) : null;
  if (videoId) {
    const name = headingText || label.textContent.trim();
    const video = decorateVideo(videoCell, videoId, name, labels);
    row.append(video.cell);
    fields.video = video.field;
  } else {
    videoCell?.remove();
  }

  // Any cell beyond the model (content authored with a newer model) stays in the panel.
  row.append(content);

  row.classList.add('tabs-panel');
  row.id = panelId;
  row.setAttribute('role', 'tabpanel');
  row.setAttribute('aria-labelledby', tabId);
  row.tabIndex = 0;

  return {
    tab, panel: row, fallbackLabel, fields,
  };
}

/**
 * Sets the data-aue-* values that are missing on an element; never overwrites one.
 * @param {?Element} element
 * @param {Object<string, string>} values dataset keys and values
 */
function setMissing(element, values) {
  if (!element) return;
  Object.entries(values).forEach(([key, value]) => {
    if (!element.dataset[key]) element.dataset[key] = value;
  });
}

/**
 * Universal Editor instrumentation (xwalk). On the author instance AEM delivers the block,
 * its items (the rows, which become the panels) and their fields already instrumented, and
 * moveInstrumentation() keeps those attributes through the decoration: they always win.
 * Only a block AEM has not instrumented (local drafts, preview) gets the fallback, with one
 * resource per block built from its id prefix (tabs-N): a block inside a fragment is
 * decorated before the fragment is attached, so its position in the document is unknown.
 * Empty fields have no node: they are edited from the properties panel of their item.
 * In both cases the tab label (title) carries the resource of its item, because it lives in
 * the tab list, outside the item.
 * @param {Element} block the decorated block
 * @param {string} prefix unique id prefix of the block
 * @param {Array<{tab: Element, panel: Element, fields: Object<string, Element>}>} items
 */
function instrumentBlock(block, prefix, items) {
  if (!block.dataset.aueResource) {
    const base = `urn:aemconnection:${window.location.pathname}#${prefix}`;
    setMissing(block, {
      aueResource: base,
      aueType: 'container',
      aueFilter: 'tabs',
      aueLabel: UE_LABELS.block,
      aueBehavior: 'component',
    });
    items.forEach(({ tab, panel, fields }, index) => {
      setMissing(panel, {
        aueResource: `${base}/item-${index}`,
        aueType: 'component',
        aueModel: 'tabs-item',
        aueLabel: `${UE_LABELS.item}: ${tab.textContent.trim() || index + 1}`,
      });
      Object.entries(fields).forEach(([prop, element]) => {
        if (element.dataset.aueProp) return;
        setMissing(element, {
          aueProp: prop,
          aueType: FIELD_TYPES[prop],
          aueLabel: UE_LABELS[prop],
        });
      });
    });
  }

  items.forEach(({ panel, fields }) => {
    if (fields.title?.dataset.aueProp && panel.dataset.aueResource) {
      setMissing(fields.title, { aueResource: panel.dataset.aueResource });
    }
  });
}

/**
 * @param {?Element} element element inside a tabs block
 * @returns {?Element} the panel it belongs to: its own, or the one its tab controls
 */
function panelOf(element) {
  const panel = element?.closest('.tabs .tabs-panel');
  if (panel) return panel;
  const tab = element?.closest('.tabs .tabs-tab');
  return tab ? document.getElementById(tab.getAttribute('aria-controls')) : null;
}

/**
 * Universal Editor: when the author selects an item, or a field of it, whose panel is
 * hidden (content tree or properties rail), its tab becomes the active one.
 * @param {CustomEvent} event aue:ui-select, detail { resource, selected }
 */
function showOnEditorSelect(event) {
  const { resource, selected } = event.detail || {};
  if (!selected) return;
  const targets = resource
    ? [...document.querySelectorAll('[data-aue-resource]')]
      .filter((element) => element.dataset.aueResource === resource)
    : [];
  if (!targets.length && event.target instanceof Element) targets.push(event.target);
  const panel = targets.map(panelOf).find(Boolean);
  if (!panel?.hidden) return;
  document.getElementById(panel.getAttribute('aria-labelledby'))?.click();
}

// Capture phase: works whether the editor dispatches the event on the element or on the
// document. One listener per module, not per block, so re-decorated blocks do not pile up.
document.addEventListener('aue:ui-select', showOnEditorSelect, true);

/**
 * Decorates the tabs block.
 *
 * DOM de entrada (matriz EDS, contrato §3b) — one row per item, one cell per field:
 *   div.tabs                                   (container, filter "tabs")
 *     └── div (item, model tabs-item) × N
 *           ├── div ← title      <p>text</p>                 tab label
 *           ├── div ← heading    <p>text</p>
 *           ├── div ← subtitle   <p>text</p>
 *           ├── div ← video      <p>URL</p> or <p><a href=URL>URL</a></p>   (rule DH-10)
 *           └── div ← richtext   <p>, <ul>, <h*> …
 *   Every field is optional; an empty field arrives as an empty cell.
 *
 * DOM de salida (contrato §3d, WAI-ARIA APG tabs with manual activation):
 *   div.tabs
 *     ├── div.tabs-nav[.tabs-expanded]
 *     │     ├── div.tabs-list[role=tablist]
 *     │     │     └── button.tabs-tab[role=tab][aria-selected][aria-controls] > span × N
 *     │     └── button.tabs-toggle[aria-expanded][aria-controls] > svg   (below 1024px)
 *     ├── div.tabs-panel[role=tabpanel][aria-labelledby][hidden] × N   (the original rows)
 *     │     ├── div.tabs-video > button.tabs-video-play > img + svg  → modal on play
 *     │     └── div.tabs-content
 *     │           ├── h3.tabs-heading
 *     │           ├── p.tabs-subtitle
 *     │           └── div.tabs-richtext
 *     └── dialog.tabs-modal > button.tabs-modal-close + div.tabs-modal-frame (iframe on play)
 *
 * Keyboard (as the portal: activation on Enter, Space or click, not on focus): arrow keys
 * move the focus between tabs, Home and End go to the first and last one. Below 1024px the
 * list collapses to the selected tab plus a toggle that shows the others; it stays open
 * after a selection, as on the portal. The video plays in a modal, as on the portal.
 *
 * @param {Element} block - Root element of the block
 */
export default function decorate(block) {
  if (block.querySelector(':scope > .tabs-nav')) return;

  blockCount += 1;
  const prefix = `tabs-${blockCount}`;
  const labels = { ...DEFAULT_LABELS };

  const nav = document.createElement('div');
  nav.className = 'tabs-nav';

  const tablist = document.createElement('div');
  tablist.className = 'tabs-list';
  tablist.id = `${prefix}-list`;
  tablist.setAttribute('role', 'tablist');

  const items = [...block.children].map((row, index) => decorateItem(row, index, prefix, labels));
  items.forEach(({ tab }) => tablist.append(tab));

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'tabs-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', tablist.id);
  toggle.setAttribute('aria-label', labels.tabsToggle);
  toggle.append(buildIcon('0 0 40 40', ['M20 12v16', 'M12 20h16']));

  nav.append(tablist, toggle);
  block.prepend(nav);

  const tabs = items.map(({ tab }) => tab);

  /** @param {boolean} expanded whether the collapsed list shows every tab */
  const setExpanded = (expanded) => {
    nav.classList.toggle('tabs-expanded', expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
  };

  /** @param {HTMLButtonElement} selected tab to show */
  const select = (selected) => {
    items.forEach(({ tab, panel }) => {
      const isSelected = tab === selected;
      tab.setAttribute('aria-selected', String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
      panel.hidden = !isSelected;
    });
  };

  /** @param {number} index tab to focus, wrapping around the ends */
  const focusTab = (index) => {
    const target = tabs[(index + tabs.length) % tabs.length];
    // A collapsed list only renders the selected tab: open it before moving the focus.
    if (!target.getClientRects().length) setExpanded(true);
    target.focus();
  };

  tablist.addEventListener('click', (event) => {
    const tab = event.target.closest('.tabs-tab');
    if (tab) select(tab);
  });

  tablist.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(event.target.closest('.tabs-tab'));
    if (index < 0) return;
    const moves = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      focusTab(moves[event.key]);
    }
  });

  nav.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !nav.classList.contains('tabs-expanded')) return;
    setExpanded(false);
    toggle.focus();
  });

  toggle.addEventListener('click', () => setExpanded(!nav.classList.contains('tabs-expanded')));

  const modal = buildModal();
  block.append(modal);
  block.addEventListener('click', (event) => {
    const play = event.target.closest('.tabs-video-play');
    if (play) playVideo(play.parentElement, modal, labels);
  });

  // The tabs read as a row from 1024px and as a column below it.
  const tabsLayout = window.matchMedia(TABS_LAYOUT_QUERY);
  const setOrientation = () => {
    // [QA] [ANTES] the listener outlived the block: Universal Editor replaces a block on
    // every edit, and each old copy stayed referenced by the media query list.
    if (block.dataset.blockStatus === 'loaded' && !block.isConnected) {
      tabsLayout.removeEventListener('change', setOrientation);
      return;
    }
    tablist.setAttribute('aria-orientation', tabsLayout.matches ? 'horizontal' : 'vertical');
  };
  setOrientation();
  tabsLayout.addEventListener('change', setOrientation);

  if (tabs.length) {
    select(tabs[0]);
    prioritizeThumbnail(block, items[0].panel);
  }

  fetchPlaceholders().then((placeholders) => {
    Object.keys(DEFAULT_LABELS).forEach((key) => {
      if (placeholders[key]) labels[key] = placeholders[key];
    });
    toggle.setAttribute('aria-label', labels.tabsToggle);
    items.forEach(({ fallbackLabel }, index) => {
      if (fallbackLabel) fallbackLabel.textContent = `${labels.tabsTab} ${index + 1}`;
    });
    block.querySelectorAll('.tabs-video').forEach((cell) => {
      const { videoName } = cell.dataset;
      const play = cell.querySelector('.tabs-video-play');
      play?.setAttribute('aria-label', videoName ? `${labels.playVideo}: ${videoName}` : labels.playVideo);
    });
  });

  instrumentBlock(block, prefix, items);
}
