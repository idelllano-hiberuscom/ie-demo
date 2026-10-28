/**
 * Cards Block — AEM Edge Delivery Services
 *
 * Contract: EDS-COMP-007 (.eds-pipeline/contracts/cards.md)
 * Base: Adobe Block Collection (cards) @ commit 5ad878ba — the container + item model. Item
 *   fields (title, links, program facts, category) and the variants no-image, stats, numbered,
 *   steps, overlay, profile and program are new (contract §1, §3f).
 * Model: xwalk (EDS + Universal Editor)
 * UE instrumentation: Completado (Fase 3)
 * QA audit: Validado
 *
 * QA Changes:
 * - The authored rows are the cards: they are decorated in place, never replaced. [ANTES] each
 *   row was emptied into a new <li> and removed, and decorate() returned early on a second run,
 *   so a re-decoration of a block with a field missing lost a whole card and its image.
 *   [DESPUÉS] every cell is tagged with its field (data-cards-field) and the generated wrappers
 *   are rebuilt on every decoration: a second run, or a run with the last cells omitted, gives
 *   the same cards with the same content.
 * - List semantics without a generated <ul>: the element that holds the cards is role="list"
 *   and each card role="listitem" (the block itself, or the generated list of numbered, stats
 *   and program, where the controls live next to it).
 * - overlay, 1:1 with the portal (orchestrator decision, closes the TODO): the title is a
 *   disclosure button and the text and link open in a full-width panel below the row of tiles,
 *   one panel open at a time, as blocks/footer does with the band of principles.
 * - stats below 900px, 1:1 with the portal (orchestrator decision): a one-figure carousel with
 *   scroll-snap, arrows (aria-disabled at the ends) and dots (aria-current), as blocks/carousel.
 *   No count-up animation (decorative). From 900px, three columns.
 * - numbered, program arrows and program tabs: closed with the orchestrator decisions (notes
 *   at each function).
 * - Fallback data-aue-* only when AEM has not instrumented the block; never overwrites. One
 *   resource per block (its id), also for blocks decorated inside a fragment.
 * - Universal Editor: selecting a card that is out of view (numbered past «Show all», program
 *   card of another tab, closed overlay panel, scrolled list) shows it (aue:ui-select).
 * - Observers and media-query listeners are released on re-decoration and once the block
 *   leaves the page (Universal Editor replaces a block on every edit).
 */

import { toCamelCase } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

/** Cells of each card, in model order (contract §3b: 12 cells, xwalk/max-cells card 12). */
const CELL_ORDER = [
  'image', 'title', 'text', 'link', 'link2',
  'duration', 'language', 'location', 'intake', 'schedule', 'format', 'category',
];

/** Program quick facts, in the order the portal lays them out (2 columns). */
const FACTS = ['duration', 'language', 'location', 'intake', 'schedule', 'format'];

/** Block options (classes, contract §5). No option is the default grid. */
const VARIANTS = ['no-image', 'stats', 'numbered', 'steps', 'overlay', 'profile', 'program'];

/** Variants whose cards live in a generated list, next to generated controls. */
const LISTED = ['numbered', 'stats', 'program'];

/**
 * Button style of link and link2 per variant, as measured in the captures (contract §2).
 * null keeps a text link (profile, program link and the variants without CTA).
 */
const LINK_STYLES = {
  default: ['secondary', 'secondary'],
  'no-image': ['primary', 'primary'],
  overlay: ['primary', 'primary'],
  program: [null, 'secondary'],
};

/** numbered: items visible before «Show all» (contract §7). */
const NUMBERED_VISIBLE = 2;

/** program: anchor of the form block that replaces the Marketo modal (reglas_variante_program). */
const FORM_ANCHOR = '#form';

/** stats: carousel below this width, three columns from it (orchestrator decision). */
const STATS_GRID_QUERY = '(width >= 1024px)';

/**
 * program: programs the portal flags as «New». POC shortcut (1:1 with the portal): the model
 * has no field for it, so the badge is painted from the path of the card link.
 */
const NEW_PROGRAMS = [
  '/university/studies/academic-programs/global-bachelor-business-administration/',
  '/business-school/programs/executive-part-time-mbas/global-mba/',
  '/business-school/programs/masters/master-in-sports-management-innovation/',
  '/masters/master-product-management-design-innovation/',
  '/masters/dual-degrees/programs/dual-degree-international-mba-master-financial-technology/',
  '/masters/dual-degrees/programs/dual-degree-international-mba-master-in-public-policy/',
  '/masters/dual-degrees/programs/dual-degree-international-mba-master-in-applied-artificial-intelligence/',
  '/masters/dual-degrees/programs/dual-degree-master-in-management-master-financial-technology/',
  '/masters/dual-degrees/programs/dual-degree-master-in-management-master-in-public-policy/',
  '/masters/dual-degree-international-mba-master-in-technology-and-global-affairs/',
  '/masters/dual-degree-master-in-management-master-in-technology-and-global-affairs/',
  '/masters/dual-degrees/programs/dual-degree-master-management-master-in-applied-artificial-intelligence/',
];

/**
 * @param {?Element} cell link cell of a program card
 * @returns {boolean} true when the link points to a program flagged as «New»
 */
function isNewProgram(cell) {
  const href = cell?.querySelector('a[href]')?.getAttribute('href');
  if (!href) return false;
  const path = new URL(href, window.location.href).pathname.replace(/\/?$/, '/');
  return NEW_PROGRAMS.includes(path);
}

/**
 * stats: a ² or ³ after the unit is set as the small superscript of the portal.
 * @param {Element} cell title cell
 */
function decorateSuperscripts(cell) {
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    if (/[²³]/.test(walker.currentNode.textContent)
      && !walker.currentNode.parentElement.classList.contains('cards-sup')) nodes.push(walker.currentNode);
  }
  nodes.forEach((node) => {
    const parts = node.textContent.split(/([²³])/);
    node.replaceWith(...parts.filter(Boolean).map((part) => {
      if (!/[²³]/.test(part)) return document.createTextNode(part);
      const sup = document.createElement('span');
      sup.className = 'cards-sup';
      sup.textContent = part === '²' ? '2' : '3';
      return sup;
    }));
  });
}

/**
 * Fallback labels, used only when the site placeholders do not define the keys.
 * The site text lives in /placeholders.json. The stats carousel shares the carousel keys.
 */
const DEFAULT_LABELS = {
  cardsShowAll: 'Show all',
  cardsShowLess: 'Show less',
  cardsPrevious: 'Previous programs',
  cardsNext: 'Next programs',
  cardsCategories: 'Program categories',
  cardsSelect: 'Select an option...',
  cardsUnlock: 'Unlock program details',
  cardsDuration: 'Duration',
  cardsLanguage: 'Language',
  cardsLocation: 'Location',
  cardsIntake: 'Intake',
  cardsSchedule: 'Schedule',
  cardsFormat: 'Format',
  carouselPrevious: 'Previous slide',
  carouselNext: 'Next slide',
  carouselSlide: 'Slide {current} of {total}',
  carouselSlides: 'Slides',
};

/** Universal Editor labels of the fallback instrumentation (fields of _cards.json). */
const UE_LABELS = {
  block: 'Tarjetas',
  item: 'Tarjeta',
  image: 'Imagen',
  title: 'Título',
  text: 'Texto',
  link: 'Enlace',
  link2: 'Segundo enlace',
  duration: 'Duración',
  language: 'Idioma',
  location: 'Ubicación',
  intake: 'Inicio',
  schedule: 'Jornada',
  format: 'Formato',
  category: 'Categoría',
};

/** data-aue-type of each field that owns a node (category is only read, never shown). */
const UE_TYPES = {
  image: 'media',
  title: 'text',
  text: 'richtext',
  link: 'aem-content',
  link2: 'aem-content',
  duration: 'text',
  language: 'text',
  location: 'text',
  intake: 'text',
  schedule: 'text',
  format: 'text',
};

/** Inline icons (decorative: the control or the hidden label carries the name). */
const ICONS = {
  duration: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="1.5" y="2.5" width="13" height="12" fill="none" stroke="currentColor"/><path d="M1.5 5.5h13M4 8h2M7 8h2M10 8h2M4 11h2M7 11h2M10 11h2" fill="none" stroke="currentColor"/></svg>',
  language: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 2C4.4 2 1.5 4.3 1.5 7.2c0 1.5.8 2.9 2.1 3.8L3 14l3.3-1.8c.5.1 1.1.2 1.7.2 3.6 0 6.5-2.3 6.5-5.2S11.6 2 8 2z" fill="none" stroke="currentColor"/></svg>',
  location: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 15s-5-5.2-5-8.5a5 5 0 0 1 10 0C13 9.8 8 15 8 15z" fill="none" stroke="currentColor"/><circle cx="8" cy="6.5" r="1.8" fill="none" stroke="currentColor"/></svg>',
  intake: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="1.5" y="2.5" width="13" height="12" fill="none" stroke="currentColor"/><path d="M1.5 5.5h13M4.5 1v3M11.5 1v3" fill="none" stroke="currentColor"/><path d="M6 8.5h1.5V12M9 8.5h1.5V12" fill="none" stroke="currentColor"/></svg>',
  schedule: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor"/><path d="M8 4v4l2.5 2" fill="none" stroke="currentColor"/></svg>',
  format: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="1.5" y="2.5" width="13" height="9" fill="none" stroke="currentColor"/><path d="M5 14.5h6M8 11.5v3" fill="none" stroke="currentColor"/></svg>',
  chevron: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M12 6l10 10-10 10" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  plus: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M16 9v14M9 16h14" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  minus: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M9 16h14" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
};

let cardsCount = 0;
let placeholdersRequest;

/** Release functions (observers, media-query listeners) of each decorated block. */
const cleanups = new WeakMap();

/** Blocks whose delegated click handler is already wired (decorate() may run twice). */
const wiredBlocks = new WeakSet();

/**
 * Fetches the site placeholders once (/placeholders.json, rows Key/Text). Keys are available
 * as written and in camelCase: toCamelCase lowercases camelCase keys (cardsShowAll ->
 * cardsshowall), so the raw key must stay readable. Any failure resolves to an empty object.
 * @returns {Promise<Object<string, string>>} placeholders
 */
function fetchPlaceholders() {
  if (!placeholdersRequest) {
    placeholdersRequest = fetch('/placeholders.json')
      .then((response) => (response.ok ? response.json() : {}))
      .then((json) => Object.fromEntries((json.data || [])
        .filter((row) => row.Key && row.Text)
        .flatMap((row) => [[toCamelCase(row.Key), row.Text], [row.Key, row.Text]])))
      .catch(() => ({}));
  }
  return placeholdersRequest;
}

/**
 * @param {Object<string, string>} labels labels in use
 * @param {string} key label key
 * @param {number} [current] 1-based position, for the {current} of {total} labels
 * @param {number} [total] number of items
 * @returns {string} the label
 */
function formatLabel(labels, key, current, total) {
  return labels[key].replace('{current}', current).replace('{total}', total);
}

/**
 * Registers a release function for the block (run on its next decoration).
 * @param {Element} block the block
 * @param {Function} release release function
 */
function addCleanup(block, release) {
  if (!cleanups.has(block)) cleanups.set(block, []);
  cleanups.get(block).push(release);
}

/**
 * @param {Element} block the block
 * @returns {boolean} true once the block was loaded and then removed from the page
 */
function isGone(block) {
  return block.dataset.blockStatus === 'loaded' && !block.isConnected;
}

/**
 * @param {?Element} cell card cell
 * @returns {boolean} true when the author left the field empty
 */
function isEmptyCell(cell) {
  return !cell || (!cell.textContent.trim() && !cell.querySelector('picture, img'));
}

/**
 * @param {Element} cell card cell
 * @returns {boolean} true when the cell holds one link and nothing else
 */
function isLinkCell(cell) {
  const links = cell.querySelectorAll('a[href]');
  return links.length === 1
    && !cell.querySelector('picture, img, h1, h2, h3, h4, h5, h6')
    && cell.textContent.trim() === links[0].textContent.trim();
}

/**
 * @param {Element} cell card cell
 * @returns {boolean} true when the cell is a single paragraph of plain text
 */
function isPlainTextCell(cell) {
  const elements = [...cell.children];
  if (!elements.length) return Boolean(cell.textContent.trim());
  return elements.length === 1 && elements[0].tagName === 'P' && !elements[0].children.length;
}

/**
 * @param {Element[]} cells card cells, fewer than the model
 * @returns {boolean} true when the cells are the model with its last fields omitted: each one
 *   fits the field of its position (image, plain text, link, rich text)
 */
function isModelPrefix(cells) {
  return cells.length < CELL_ORDER.length && cells.every((cell, index) => {
    if (isEmptyCell(cell)) return true;
    const field = CELL_ORDER[index];
    const hasMedia = Boolean(cell.querySelector('picture, img'));
    if (field === 'image') return hasMedia;
    if (hasMedia) return false;
    if (field === 'text') return true;
    if (field === 'link' || field === 'link2') return isLinkCell(cell) || isPlainTextCell(cell);
    return isPlainTextCell(cell);
  });
}

/**
 * Maps the cells of a card to the model fields and tags each cell with its field
 * (data-cards-field), so a later decoration reads the same mapping wherever the cell is.
 * The full model delivers the 12 cells in order (contract §3b), so they are read by position;
 * so are fewer cells when they are that order with the last fields omitted. Anything else (a
 * card of the boilerplate, image + rich text) is classified by content: image, links, then
 * title (a leading plain paragraph) and text.
 * @param {Element[]} cells card cells
 * @returns {Object<string, ?Element>} one cell (or null) per field of CELL_ORDER, plus empty
 *   (cells the author left blank) and extra (further text cells)
 */
function mapCells(cells) {
  const fields = Object.fromEntries(CELL_ORDER.map((name) => [name, null]));
  fields.empty = [];
  fields.extra = [];
  const assign = (cell, name) => {
    cell.dataset.cardsField = name;
    if (isEmptyCell(cell)) fields.empty.push(cell);
    else if (CELL_ORDER.includes(name) && !fields[name]) fields[name] = cell;
    else fields.extra.push(cell);
  };

  // already mapped by a previous decoration: the tag wins over the position
  if (cells.some((cell) => cell.dataset.cardsField)) {
    cells.forEach((cell) => assign(cell, cell.dataset.cardsField || 'extra'));
    return fields;
  }

  if (cells.length === CELL_ORDER.length || isModelPrefix(cells)) {
    cells.forEach((cell, index) => assign(cell, CELL_ORDER[index]));
    return fields;
  }

  const textCells = [];
  cells.forEach((cell) => {
    if (isEmptyCell(cell)) assign(cell, 'empty');
    else if (!fields.image && cell.querySelector('picture, img')) assign(cell, 'image');
    else if (!fields.link && isLinkCell(cell)) assign(cell, 'link');
    else if (!fields.link2 && isLinkCell(cell)) assign(cell, 'link2');
    else textCells.push(cell);
  });
  if (textCells.length > 1 && isPlainTextCell(textCells[0])) assign(textCells.shift(), 'title');
  textCells.forEach((cell, index) => assign(cell, index === 0 ? 'text' : 'extra'));
  return fields;
}

/**
 * Undoes the generated structure of a decorated card: its cells go back to the row as direct
 * children and every wrapper the block added is dropped. The authored cells and their
 * instrumentation are never re-created.
 * @param {Element} row card row
 */
function restoreRow(row) {
  const cells = [...row.querySelectorAll('[data-cards-field]')];
  if (!cells.length) return;

  // overlay: the title text leaves its disclosure button
  row.querySelectorAll('.cards-card-toggle').forEach((button) => {
    button.before(...button.childNodes);
    button.remove();
  });

  row.append(...cells);
  [...row.children].filter((child) => !cells.includes(child)).forEach((child) => child.remove());
  cells.forEach((cell) => {
    cell.hidden = false;
    [...cell.classList].filter((name) => name.startsWith('cards-'))
      .forEach((name) => cell.classList.remove(name));
  });
}

/**
 * Gets the card rows back from a decorated block (some variants keep them in a generated
 * list) and drops every generated control. On a block that was never decorated, the rows are
 * its children.
 * @param {Element} block the block
 * @returns {Element[]} the card rows, in order, as direct children of the block
 */
function restoreBlock(block) {
  (cleanups.get(block) || []).forEach((release) => release());
  cleanups.delete(block);
  // whitespace between the rows of the delivered markup: no content, and it would end up
  // before the rows once they are appended again
  [...block.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE && !node.textContent.trim())
    .forEach((node) => node.remove());

  const rows = [...block.querySelectorAll('.cards-card')]
    .filter((row) => row.parentElement.closest('.cards') === block);
  if (!rows.length) return [...block.children];

  block.append(...rows);
  [...block.children].filter((child) => !rows.includes(child)).forEach((child) => child.remove());
  block.removeAttribute('role');
  return rows;
}

/**
 * Turns the plain-text title into an h3 (the section heading before the block is an h2),
 * keeping the authored text and its Universal Editor attributes.
 * @param {Element} cell title cell
 * @returns {Element} the heading
 */
function decorateTitle(cell) {
  const existing = cell.querySelector('h1, h2, h3, h4, h5, h6');
  if (existing) return existing;

  const heading = document.createElement('h3');
  const paragraph = cell.querySelector('p');
  if (paragraph) {
    paragraph.before(heading);
    heading.append(...paragraph.childNodes);
    moveInstrumentation(paragraph, heading);
    paragraph.remove();
  } else {
    heading.append(...cell.childNodes);
    cell.append(heading);
  }
  return heading;
}

/**
 * program: «Unlock program details» arrives with its text and no URL (link2 empty, link2Text
 * set). It points to the form anchor of the page (reglas_variante_program).
 * @param {Element} cell link2 cell
 */
function linkToForm(cell) {
  const anchor = cell.querySelector('a');
  if (anchor) {
    const href = anchor.getAttribute('href');
    if (!href || href === '#') anchor.setAttribute('href', FORM_ANCHOR);
    return;
  }
  const paragraph = cell.querySelector('p') || cell;
  const link = document.createElement('a');
  link.href = FORM_ANCHOR;
  link.append(...paragraph.childNodes);
  paragraph.append(link);
}

/**
 * Gives the link of a cell its style: a button of the variant, or a text link.
 * @param {Element} cell link or link2 cell
 * @param {?string} style 'primary', 'secondary' or null (text link)
 */
function styleLink(cell, style) {
  const anchor = cell.querySelector('a[href]');
  if (!anchor) return;
  anchor.classList.remove('button', 'primary', 'secondary', 'accent');
  if (style) anchor.classList.add('button', style);
}

/**
 * program: the six quick facts, each with its icon and a hidden label that names it. The fact
 * cells move into the list; the icon and the label are generated next to them.
 * @param {Object<string, ?Element>} fields cells per field
 * @param {Object<string, string>} labels labels in use
 * @returns {?Element} the list, or null when no fact is filled
 */
function buildFacts(fields, labels) {
  const facts = FACTS.filter((name) => fields[name]);
  if (!facts.length) return null;

  const list = document.createElement('ul');
  list.className = 'cards-card-facts';
  facts.forEach((name) => {
    const item = document.createElement('li');
    item.className = 'cards-card-fact';

    const icon = document.createElement('span');
    icon.className = 'cards-card-fact-icon';
    icon.innerHTML = ICONS[name];

    const label = document.createElement('span');
    label.className = 'cards-sr-only';
    label.dataset.label = `cards${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    label.textContent = `${labels[label.dataset.label]}: `;

    const value = fields[name];
    value.classList.add('cards-card-fact-value');
    item.append(icon, label, value);
    list.append(item);
  });
  return list;
}

/**
 * overlay: the title becomes a disclosure button (WAI-ARIA disclosure) that opens the text
 * and the links in a panel below the row of tiles (orchestrator decision, 1:1 with the
 * portal). The panel stays inside its card: the grid places it under the row (dense flow), so
 * the reading order is button → panel and the fields keep the resource of their item.
 * The panel repeats the title as the portal does, hidden from assistive technology (the
 * button already names it).
 * @param {Element} heading title heading
 * @param {Element} details panel with the text and the links
 */
function buildDisclosure(heading, details) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cards-card-toggle';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', details.id);
  button.append(...heading.childNodes);
  heading.append(button);

  const title = document.createElement('p');
  title.className = 'cards-card-details-title';
  title.setAttribute('aria-hidden', 'true');
  title.textContent = button.textContent.trim();
  details.prepend(title);
  details.hidden = true;
}

/**
 * overlay: opens one panel and closes the others of the block (one panel open at a time).
 * @param {Element} block the block
 * @param {Element} button the disclosure button pressed
 */
function toggleDetails(block, button) {
  const opening = button.getAttribute('aria-expanded') !== 'true';
  block.querySelectorAll('.cards-card-toggle').forEach((other) => {
    const card = other.closest('.cards-card');
    const panel = card?.querySelector(':scope > .cards-card-details');
    const open = other === button && opening;
    other.setAttribute('aria-expanded', String(open));
    if (panel) panel.hidden = !open;
  });
}

/**
 * Decorates one card in place: the row stays where EDS delivered it and keeps its cells; only
 * the wrappers that lay them out are generated.
 *
 * Children of the decorated row, in order: the image cell, div.cards-card-body (title, facts,
 * text, actions) and the cells left hidden (empty, or fields the variant does not show).
 * steps puts the body before its illustration; overlay groups image and body in
 * div.cards-card-tile and adds its panel, div.cards-card-details, after it.
 * @param {Element} row card row
 * @param {string} variant block option in use ('default' when none)
 * @param {string} id id for the card, when it has none
 * @param {Object<string, string>} labels labels in use
 */
function decorateCard(row, variant, id, labels) {
  restoreRow(row);
  row.classList.add('cards-card');
  row.id = row.id || id;
  row.setAttribute('role', 'listitem');
  row.hidden = false;
  delete row.dataset.category;

  const fields = mapCells([...row.children]);
  const program = variant === 'program';

  if (fields.image) {
    fields.image.classList.add('cards-card-image');
    fields.image.querySelectorAll('img').forEach((img) => {
      // never above the fold (contract §2, §6): every card image loads lazily
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
    });
  }

  const body = document.createElement('div');
  body.className = 'cards-card-body';

  let heading = null;
  if (fields.title) {
    fields.title.classList.add('cards-card-title');
    // stats: the figure is a value, not a heading
    if (variant !== 'stats') heading = decorateTitle(fields.title);
    else decorateSuperscripts(fields.title);
    body.append(fields.title);
  }

  const facts = program ? buildFacts(fields, labels) : null;
  if (facts) body.append(facts);

  const details = document.createElement('div');
  details.className = 'cards-card-details';
  details.id = `${row.id}-details`;

  [fields.text, ...fields.extra].filter(Boolean).forEach((cell) => {
    cell.classList.add('cards-card-text');
    details.append(cell);
  });

  const actions = document.createElement('div');
  actions.className = 'cards-card-actions';
  const styles = LINK_STYLES[variant] || [null, null];
  ['link', 'link2'].forEach((name, index) => {
    const cell = fields[name];
    if (!cell) return;
    if (program && name === 'link2') linkToForm(cell);
    styleLink(cell, styles[index]);
    actions.append(cell);
  });
  // program without link2 (authored empty): the portal still shows «Unlock program details»
  // to the form (POC shortcut, 1:1 with the portal). Generated, so a re-decoration drops it.
  if (program && !fields.link2) {
    const unlock = document.createElement('p');
    const anchor = document.createElement('a');
    anchor.href = FORM_ANCHOR;
    anchor.className = 'button secondary';
    anchor.textContent = labels.cardsUnlock;
    unlock.append(anchor);
    actions.append(unlock);
  }
  if (actions.children.length) details.append(actions);

  const reveal = variant === 'overlay' && heading && details.children.length;
  if (reveal) buildDisclosure(heading, details);
  else body.append(...details.children);

  // facts and category belong to program only; elsewhere they stay in the card, hidden
  const unused = program ? [] : FACTS.map((name) => fields[name]).filter(Boolean);
  if (fields.category) {
    if (program) row.dataset.category = fields.category.textContent.trim();
    unused.push(fields.category);
  }
  // blank and unused cells keep their place for the editor, hidden, at the end of the card
  const hidden = [...fields.empty, ...unused];
  hidden.forEach((cell) => { cell.hidden = true; });

  const image = fields.image ? [fields.image] : [];
  if (variant === 'overlay') {
    const tile = document.createElement('div');
    tile.className = 'cards-card-tile';
    tile.append(...image, body);
    row.append(tile);
    if (reveal) row.append(details);
  } else if (variant === 'steps') {
    // the text panel comes before its illustration (captures, contract §2)
    row.append(body, ...image);
  } else {
    row.append(...image, body);
  }
  row.append(...hidden);

  if (program && isNewProgram(fields.link)) {
    const badge = document.createElement('span');
    badge.className = 'cards-card-badge';
    badge.textContent = 'New';
    row.prepend(badge);
  }
}

/**
 * numbered: shows the first items and a «Show all» button that reveals the rest. Once
 * expanded, the button stays and collapses the list again («Show less», minus icon): closes
 * the TODO with the orchestrator decision.
 * @param {Element} block the block
 * @param {Element} list the card list
 * @param {Object<string, string>} labels labels in use
 */
function buildShowAll(block, list, labels) {
  const rest = [...list.children].slice(NUMBERED_VISIBLE);
  if (!rest.length) return;

  rest.forEach((card) => { card.hidden = true; });
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cards-show-all';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', list.id);
  button.dataset.label = 'cardsShowAll';
  button.setAttribute('aria-label', labels.cardsShowAll);
  button.innerHTML = ICONS.plus;

  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    rest.forEach((card) => { card.hidden = !expanded; });
    button.innerHTML = expanded ? ICONS.minus : ICONS.plus;
    const key = expanded ? 'cardsShowLess' : 'cardsShowAll';
    button.dataset.label = key;
    button.setAttribute('aria-label', (block.cardsLabels || labels)[key]);
  });
  block.append(button);
}

/**
 * @param {Element} list a scrolling card list
 * @returns {{atStart: boolean, atEnd: boolean}} whether the list is at either end
 */
function scrollEnds(list) {
  return {
    atStart: list.scrollLeft <= 1,
    atEnd: list.scrollLeft + list.clientWidth >= list.scrollWidth - 1,
  };
}

/**
 * Builds a previous/next arrow.
 * @param {string} className cards-prev or cards-next
 * @param {string} key label key
 * @param {Object<string, string>} labels labels in use
 * @returns {Element} the button
 */
function createArrow(className, key, labels) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `cards-arrow ${className}`;
  button.dataset.label = key;
  button.setAttribute('aria-label', labels[key]);
  button.innerHTML = ICONS.chevron;
  return button;
}

/**
 * Calls the update once per frame at most while the list scrolls or resizes, and releases
 * the observer with the block.
 * @param {Element} block the block
 * @param {Element} list the scrolling list
 * @param {Function} update state update
 */
function watchScroll(block, list, update) {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };
  list.addEventListener('scroll', schedule, { passive: true });
  const observer = new ResizeObserver(() => {
    if (isGone(block)) observer.disconnect();
    else schedule();
  });
  observer.observe(list);
  addCleanup(block, () => observer.disconnect());
}

/**
 * program: marks the arrow of an end as inactive. aria-disabled, not disabled, and the CSS
 * hides it as in the captures; if the arrow had the focus it passes to the other one, so the
 * focus is never lost. Closes the TODO with the orchestrator decision.
 * @param {Element} panel the program panel
 */
function updateArrows(panel) {
  const list = panel.querySelector(':scope > .cards-list');
  const { atStart, atEnd } = scrollEnds(list);
  [['.cards-prev', atStart], ['.cards-next', atEnd]].forEach(([selector, inactive]) => {
    const arrow = panel.querySelector(`:scope > ${selector}`);
    if (!arrow) return;
    arrow.setAttribute('aria-disabled', String(inactive));
    if (inactive && document.activeElement === arrow) {
      const other = panel.querySelector(`:scope > ${selector === '.cards-prev' ? '.cards-next' : '.cards-prev'}`);
      if (other?.getAttribute('aria-disabled') === 'false') other.focus();
    }
  });
}

/**
 * program: scrolls one card back or forward. Nothing happens at an end.
 * @param {Element} list the program list
 * @param {number} direction -1 (previous) or 1 (next)
 */
function scrollCards(list, direction) {
  const { atStart, atEnd } = scrollEnds(list);
  if ((direction > 0 && atEnd) || (direction < 0 && atStart)) return;
  const card = list.querySelector(':scope > .cards-card:not([hidden])');
  if (!card) return;
  const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  list.scrollBy({ left: direction * (card.offsetWidth + gap), behavior: reduceMotion ? 'auto' : 'smooth' });
}

/**
 * program: previous/next arrows over the horizontal list (contract §7).
 * @param {Element} block the block
 * @param {Element} panel the program panel
 * @param {Object<string, string>} labels labels in use
 */
function buildArrows(block, panel, labels) {
  const list = panel.querySelector(':scope > .cards-list');
  [['cards-prev', 'cardsPrevious', -1], ['cards-next', 'cardsNext', 1]].forEach(([className, key, direction]) => {
    const button = createArrow(className, key, labels);
    button.addEventListener('click', () => scrollCards(list, direction));
    panel.append(button);
  });
  watchScroll(block, list, () => updateArrows(panel));
  updateArrows(panel);
}

/**
 * program: shows the cards of a category. Cards without category show in every tab.
 * @param {Element} panel the program panel
 * @param {Element} tab the tab to select
 */
function selectTab(panel, tab) {
  const tablist = tab.parentElement;
  tablist.querySelectorAll('[role="tab"]').forEach((item) => {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
  panel.setAttribute('aria-labelledby', tab.id);
  const select = tablist.parentElement.querySelector(':scope > .cards-select');
  if (select) select.value = tab.dataset.category;

  const list = panel.querySelector(':scope > .cards-list');
  list.querySelectorAll(':scope > .cards-card').forEach((card) => {
    card.hidden = Boolean(card.dataset.category) && card.dataset.category !== tab.dataset.category;
  });
  list.scrollLeft = 0;
  updateArrows(panel);
}

/**
 * program: category tabs (WAI-ARIA tablist with automatic activation), only when some card
 * has a category (EV-04, reglas_variante_program). The tabs follow the order in which each
 * category first appears. 1:1 with the portal: no tab is selected on load and every card shows,
 * in its order; a tab filters when pressed. Cards without category show in every tab. Below
 * 768px a select (the portal one) replaces the tabs.
 * @param {Element} block the block
 * @param {Element} panel the program panel
 * @param {Object<string, string>} labels labels in use
 */
function buildTabs(block, panel, labels) {
  const categories = [...new Set([...panel.querySelectorAll('.cards-list > .cards-card[data-category]')]
    .map((card) => card.dataset.category))];
  if (!categories.length) return;

  const tablist = document.createElement('div');
  tablist.className = 'cards-tabs';
  tablist.setAttribute('role', 'tablist');
  tablist.dataset.label = 'cardsCategories';
  tablist.setAttribute('aria-label', labels.cardsCategories);

  categories.forEach((category, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'cards-tab';
    tab.id = `${block.id}-tab-${index + 1}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    tab.dataset.category = category;
    tab.textContent = category;
    tablist.append(tab);
  });

  tablist.addEventListener('click', (event) => {
    const tab = event.target.closest('.cards-tab');
    if (tab) selectTab(panel, tab);
  });

  tablist.addEventListener('keydown', (event) => {
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const current = tabs.indexOf(event.target.closest('.cards-tab'));
    if (current < 0) return;
    const moves = {
      ArrowRight: (current + 1) % tabs.length,
      ArrowLeft: (current - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = tabs[moves[event.key]];
    next.focus();
    selectTab(panel, next);
  });

  // 1:1 portal: below 768px a select replaces the tabs (the CSS shows one or the other)
  const select = document.createElement('select');
  select.className = 'cards-select';
  select.dataset.label = 'cardsCategories';
  select.setAttribute('aria-label', labels.cardsCategories);
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.textContent = labels.cardsSelect;
  select.append(placeholder);
  categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    select.append(option);
  });
  select.addEventListener('change', () => {
    const tab = [...tablist.children].find((item) => item.dataset.category === select.value);
    if (tab) selectTab(panel, tab);
  });

  panel.setAttribute('role', 'tabpanel');
  panel.before(tablist, select);
  // 1:1 portal: no tab is selected on load and every card shows, in its order
  tablist.firstElementChild.tabIndex = 0;
  [...tablist.children].slice(1).forEach((tab) => { tab.tabIndex = -1; });
  tablist.querySelectorAll('[role="tab"]').forEach((tab) => tab.setAttribute('aria-selected', 'false'));
}

/**
 * stats below 900px: one figure per view with scroll-snap, arrows and dots (APG carousel
 * controls, as blocks/carousel): the arrows get aria-disabled at the ends and the dots
 * aria-current. From 900px the CSS lays the figures in three columns and hides the controls.
 * No count-up animation (decorative, orchestrator decision).
 * @param {Element} block the block
 * @param {Element} list the list of figures
 * @param {Object<string, string>} labels labels in use
 */
function buildStatsCarousel(block, list, labels) {
  const cards = [...list.children];
  if (cards.length < 2) return;

  const controls = document.createElement('div');
  controls.className = 'cards-controls';
  const prev = createArrow('cards-prev', 'carouselPrevious', labels);
  const next = createArrow('cards-next', 'carouselNext', labels);

  const dots = document.createElement('ol');
  dots.className = 'cards-dots';
  dots.dataset.label = 'carouselSlides';
  dots.setAttribute('aria-label', labels.carouselSlides);
  cards.forEach((card, index) => {
    const item = document.createElement('li');
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'cards-dot';
    dot.dataset.label = 'carouselSlide';
    dot.dataset.index = index;
    dot.setAttribute('aria-label', formatLabel(labels, 'carouselSlide', index + 1, cards.length));
    dot.setAttribute('aria-controls', list.id);
    item.append(dot);
    dots.append(item);
  });
  controls.append(prev, dots, next);
  block.append(controls);

  // one figure per view: the position is the scroll offset in list widths
  const current = () => Math.round(list.scrollLeft / (list.clientWidth || 1));
  const show = (index) => {
    const target = Math.max(0, Math.min(index, cards.length - 1));
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo({ left: target * list.clientWidth, behavior: reduceMotion ? 'auto' : 'smooth' });
  };
  const update = () => {
    const index = current();
    const { atStart, atEnd } = scrollEnds(list);
    prev.setAttribute('aria-disabled', String(atStart));
    next.setAttribute('aria-disabled', String(atEnd));
    dots.querySelectorAll('.cards-dot').forEach((dot, position) => {
      if (position === index) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  };

  prev.addEventListener('click', () => { if (!scrollEnds(list).atStart) show(current() - 1); });
  next.addEventListener('click', () => { if (!scrollEnds(list).atEnd) show(current() + 1); });
  dots.addEventListener('click', (event) => {
    const dot = event.target.closest('.cards-dot');
    if (dot) show(Number(dot.dataset.index));
  });
  watchScroll(block, list, update);

  // the figures carry no link: below 900px the scroller itself takes the keyboard focus
  const grid = window.matchMedia(STATS_GRID_QUERY);
  const setFocusable = () => {
    if (isGone(block)) {
      grid.removeEventListener('change', setFocusable);
      return;
    }
    if (grid.matches) list.removeAttribute('tabindex');
    else list.tabIndex = 0;
  };
  setFocusable();
  grid.addEventListener('change', setFocusable);
  addCleanup(block, () => grid.removeEventListener('change', setFocusable));
  update();
}

/**
 * Writes the site labels (placeholders) over the English fallback.
 * @param {Element} block the block
 */
function applyPlaceholders(block) {
  fetchPlaceholders().then((placeholders) => {
    const labels = { ...DEFAULT_LABELS };
    Object.keys(labels).forEach((key) => {
      if (placeholders[key]) labels[key] = placeholders[key];
    });
    block.cardsLabels = labels;
    block.querySelectorAll('.cards-sr-only[data-label]').forEach((label) => {
      label.textContent = `${labels[label.dataset.label]}: `;
    });
    const total = block.querySelectorAll('.cards-dot').length;
    block.querySelectorAll('[data-label]:not(.cards-sr-only)').forEach((element) => {
      const { label, index } = element.dataset;
      const text = index === undefined ? labels[label]
        : formatLabel(labels, label, Number(index) + 1, total);
      element.setAttribute('aria-label', text);
    });
  });
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
 * Fallback instrumentation for Universal Editor. AEM delivers the data-aue-* attributes of
 * the block, its cards and their fields when the page is opened in the editor, and the rows
 * and cells are never re-created (the title moves its attributes to its heading), so those
 * always win. This only runs when the block arrives without them (local drafts, preview).
 * imageAlt, linkText and link2Text collapse into the alt and the text of their pair; classes
 * is a block option; hidden cells (empty, or a field the variant does not show) have no node
 * to point at and are edited from the properties panel.
 * @param {Element} block the decorated block
 * @param {Element[]} rows card rows
 */
function instrumentFallback(block, rows) {
  if (block.dataset.aueResource) return;
  // the block id (cards-N), not its position in the document: a block inside a fragment is
  // decorated before the fragment is attached, and would repeat a resource
  const base = `urn:aemconnection:${window.location.pathname}#${block.id}`;
  setMissing(block, {
    aueResource: base,
    aueType: 'container',
    aueFilter: 'cards',
    aueModel: 'cards',
    aueLabel: UE_LABELS.block,
    aueBehavior: 'component',
  });

  // [ANTES] any hidden ancestor skipped the field: closed overlay panels, numbered cards past
  // «Show all» and program cards of another tab had no node. Only hidden cells are skipped.
  const field = (element, prop) => {
    if (!element || element.dataset.aueProp || element.closest('[data-cards-field]')?.hidden) return;
    setMissing(element, { aueProp: prop, aueType: UE_TYPES[prop], aueLabel: UE_LABELS[prop] });
  };

  rows.forEach((row, index) => {
    const cell = (name) => row.querySelector(`[data-cards-field="${name}"]`);
    const titleCell = cell('title');
    const title = titleCell?.querySelector('h1, h2, h3, h4, h5, h6, p') || titleCell;
    setMissing(row, {
      aueResource: `${base}/item-${index}`,
      aueType: 'component',
      aueModel: 'card',
      aueLabel: `${UE_LABELS.item}: ${title?.textContent.trim() || index + 1}`,
    });
    field(cell('image')?.querySelector('img'), 'image');
    field(title, 'title');
    field(cell('text'), 'text');
    field(cell('link')?.querySelector('a[href]'), 'link');
    field(cell('link2')?.querySelector('a[href]'), 'link2');
    FACTS.forEach((name) => {
      const fact = cell(name);
      field(fact?.querySelector('p') || fact, name);
    });
  });
}

/**
 * Universal Editor: when the author selects a card, or a field of it, that is not in view
 * (content tree or properties rail), the block shows it: numbered expands, program selects
 * the tab of its category, overlay opens its panel, and a scrolling list brings it in.
 * @param {CustomEvent} event aue:ui-select, detail { resource, selected }
 */
function revealOnEditorSelect(event) {
  const { resource, selected } = event.detail || {};
  if (!selected) return;
  const target = (resource && [...document.querySelectorAll('[data-aue-resource]')]
    .find((element) => element.dataset.aueResource === resource))
    || (event.target instanceof Element ? event.target : null);
  const card = target?.closest('.cards .cards-card');
  const block = card?.closest('.cards');
  if (!card || !block) return;

  if (card.hidden) {
    block.querySelector(':scope > .cards-show-all[aria-expanded="false"]')?.click();
    [...block.querySelectorAll('.cards-tab')]
      .find((tab) => tab.dataset.category === card.dataset.category)?.click();
  }
  card.querySelector('.cards-card-toggle[aria-expanded="false"]')?.click();
  if (card.parentElement.classList.contains('cards-list')) {
    card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

// Capture phase: works whether the editor dispatches the event on the element or on the
// document. One listener per module, not per block, so re-decorated blocks do not pile up.
document.addEventListener('aue:ui-select', revealOnEditorSelect, true);

/**
 * Decorates the cards block. It can run more than once on the same block (a copy of a
 * rendered block, a re-render): the rows and cells are recovered from the previous decoration
 * and the generated structure is built again, so nothing authored is lost or duplicated.
 *
 * DOM de entrada (matriz EDS, contrato §3b) — one row per card, 12 cells in model order:
 *   div.cards[.no-image|.stats|.numbered|.steps|.overlay|.profile|.program]  ← classes
 *     └── div (card) × N
 *           ├── div  image: <picture> (alt = imageAlt)
 *           ├── div  title: <p> (plain text)
 *           ├── div  text: richtext (<p>, <ul>, <h*>)
 *           ├── div  link: <p><a href>linkText</a></p>
 *           ├── div  link2: <p><a href>link2Text</a></p> (program: text only → #form)
 *           ├── div  duration · ├── div language · ├── div location   (program only)
 *           ├── div  intake   · ├── div schedule · ├── div format     (program only)
 *           └── div  category: <p> (program only, tabs)
 *   Trailing fields may be omitted; fewer cells (a boilerplate card: image + rich text) are
 *   read by content.
 *
 * DOM de salida (contrato §3d; the rows are the cards, decorated in place):
 *   div.cards[role=list]                    (default, no-image, steps, overlay, profile)
 *     └── div.cards-card[role=listitem] × N (the authored row)
 *           ├── div.cards-card-image  <picture>                (image cell)
 *           ├── div.cards-card-body
 *           │     ├── div.cards-card-title (h3; stats: p)       (title cell)
 *           │     ├── ul.cards-card-facts > li × 6 (icon, label, fact cell)   (program)
 *           │     ├── div.cards-card-text                       (text cell)
 *           │     └── div.cards-card-actions > link and link2 cells
 *           └── div[hidden] × n                                 (empty or unused cells)
 *   overlay: div.cards-card-tile (image + body, title h3 > button.cards-card-toggle) and
 *     div.cards-card-details[hidden] (text + actions), both in the card.
 *   numbered: div.cards-list[role=list] > cards · button.cards-show-all
 *   stats:    div.cards-list[role=list] > cards · div.cards-controls (arrows, ol.cards-dots)
 *   program:  div.cards-tabs[role=tablist] (with categories) ·
 *             div.cards-panel > div.cards-list[role=list] > cards, button.cards-arrow × 2
 *
 * @param {Element} block - Root element of the block
 */
export default function decorate(block) {
  const rows = restoreBlock(block);

  if (!block.id) {
    cardsCount += 1;
    block.id = `cards-${cardsCount}`;
  }
  const variant = VARIANTS.find((name) => block.classList.contains(name)) || 'default';
  const labels = { ...DEFAULT_LABELS, ...block.cardsLabels };

  rows.forEach((row, index) => decorateCard(row, variant, `${block.id}-card-${index + 1}`, labels));

  let list = block;
  if (LISTED.includes(variant)) {
    list = document.createElement('div');
    list.className = 'cards-list';
    list.id = `${block.id}-list`;
    list.append(...rows);
  }
  list.setAttribute('role', 'list');

  if (variant === 'program') {
    const panel = document.createElement('div');
    panel.className = 'cards-panel';
    panel.id = `${block.id}-panel`;
    panel.append(list);
    block.append(panel);
    if (rows.length > 1) buildArrows(block, panel, labels);
    buildTabs(block, panel, labels);
  } else if (variant === 'stats') {
    block.append(list);
    buildStatsCarousel(block, list, labels);
  } else if (variant === 'numbered') {
    block.append(list);
    buildShowAll(block, list, labels);
  }

  // steps, desktop: text and illustration panels share a 3-column grid; with 4, 7… steps the
  // last illustration fills the 2 columns left in its row, as on the portal
  const lastImage = variant === 'steps' && rows[rows.length - 1]?.querySelector(':scope > .cards-card-image');
  if (lastImage && rows.length % 3 === 1) lastImage.classList.add('cards-card-wide');

  if (variant === 'overlay' && !wiredBlocks.has(block)) {
    wiredBlocks.add(block);
    block.addEventListener('click', (event) => {
      const button = event.target.closest('.cards-card-toggle');
      if (button && block.contains(button)) toggleDetails(block, button);
    });
  }

  instrumentFallback(block, rows);
  if (['numbered', 'program', 'stats'].includes(variant)) applyPlaceholders(block);
}
