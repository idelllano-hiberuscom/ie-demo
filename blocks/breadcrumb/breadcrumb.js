/**
 * Breadcrumb Block — AEM Edge Delivery Services
 *
 * Contract: EDS-COMP-006 (.eds-pipeline/contracts/breadcrumb.md)
 * Base: none (new block, no Block Collection reference)
 * Model: xwalk (EDS + Universal Editor)
 * UE instrumentation: Completado (Fase 3)
 * QA audit: Validado
 *
 * QA Changes:
 * - The label of every level lives in its own span. It used to take the label instrumentation
 *   on the li of the current page, which already carried the item's: the label's data-aue-type
 *   "text" overwrote the item's "component", and the current level stopped being an item for
 *   Universal Editor (it could not be selected, moved or deleted).
 * - Inside a link the label also has its own span, so the link keeps the instrumentation of the
 *   link field (AEM's, moved from its cell) and the label keeps its own: both fields of the
 *   contract have a data-aue-prop.
 * - Fallback data-aue-* only when AEM has not instrumented the block (local drafts, preview),
 *   never over the attributes AEM delivers.
 *
 * DOM de entrada (matriz EDS, contrato §3b):
 *   div.breadcrumb                          (container, filter "breadcrumb")
 *     └── div (item, model breadcrumb-item) × N
 *           ├── div ← label  <p>text</p>                 (required)
 *           └── div ← link   <p><a href>…</a></p>         (optional; ignored on the last item)
 *
 * DOM de salida (contrato §3d):
 *   div.breadcrumb
 *     └── nav[aria-label]
 *           └── ol
 *                 ├── li > a[href] > span          (level with link)
 *                 ├── li > span                    (intermediate level without link)
 *                 └── li[aria-current="page"] > span   (last item: current page, text only)
 *
 * Placement (orchestrator decision, 1:1 with the portal; closes the former blocking TODO 1):
 * authored in the same section as the hero, right after it, the trail overlays the bottom of
 * the hero, in white. That is CSS only (breadcrumb.css); anywhere else it renders on its own.
 *
 * Hover of the level links: the portal colour, as the global token --link-hover-color
 * (EDS-FIX-002, also over the hero); focus is the global ring of styles.css.
 */

import { moveInstrumentation } from '../../scripts/scripts.js';

// i18n: fixed label painted by the block (DH-06). Single place to translate it.
const LABELS = {
  nav: 'Breadcrumb',
};

// Universal Editor labels of the fallback instrumentation (fields of _breadcrumb.json).
const UE_LABELS = {
  block: 'Miga de pan',
  item: 'Nivel',
  label: 'Texto del nivel',
  link: 'Enlace del nivel',
};

/**
 * Moves the instrumentation of a cell (and of its paragraph, where AEM puts the field) to the
 * element that now shows its content, unless that element already carries a field of its own.
 * @param {?Element} cell cell of the item
 * @param {Element} target element that shows the content of the cell
 */
function moveCellInstrumentation(cell, target) {
  if (!cell || target.hasAttribute('data-aue-prop')) return;
  const source = cell.querySelector(':scope > p') || cell;
  moveInstrumentation(cell, target);
  if (source !== cell) moveInstrumentation(source, target);
}

/**
 * Reads one authored row. Rows without a label (and without a usable link text) are skipped.
 * @param {Element} row item row of the block
 * @returns {{row: Element, labelCell: Element, linkCell: ?Element,
 *   link: HTMLAnchorElement|null, label: string}|null}
 */
function readItem(row) {
  const [labelCell, linkCell] = row.children;
  const link = linkCell?.querySelector('a[href]') || null;
  let label = labelCell?.textContent.trim() || '';

  // Tolerance: an empty label falls back to the link text, unless that text is the raw URL.
  if (!label && link) {
    const text = link.textContent.trim();
    if (text && text !== link.getAttribute('href')) label = text;
  }

  return label ? {
    row, labelCell, linkCell, link, label,
  } : null;
}

/**
 * Builds the list item of one level.
 * @param {{row: Element, labelCell: Element, linkCell: ?Element,
 *   link: HTMLAnchorElement|null, label: string}} item
 * @param {boolean} isCurrent whether this is the last item (the current page)
 * @returns {HTMLLIElement} the list item
 */
function buildItem(item, isCurrent) {
  const {
    row, labelCell, linkCell, link, label,
  } = item;
  const li = document.createElement('li');
  moveInstrumentation(row, li);

  // The label always has a node of its own: the li carries the item, the link the link field.
  const text = document.createElement('span');
  text.textContent = label;
  moveCellInstrumentation(labelCell, text);

  if (isCurrent) {
    li.setAttribute('aria-current', 'page');
    li.append(text);
    return li;
  }

  if (link) {
    // decorateButtons() copies the raw link text (the URL) into the title: it is not authored.
    if (link.title === link.textContent.trim()) link.removeAttribute('title');
    moveCellInstrumentation(linkCell, link);
    link.textContent = '';
    link.append(text);
    li.append(link);
  } else {
    li.append(text);
  }
  return li;
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

/** Blocks instrumented by the fallback while detached from the document (fragments). */
let detachedCount = 0;

/**
 * Fallback instrumentation for Universal Editor. AEM delivers the data-aue-* attributes of the
 * block, its items and their fields when the page is opened in the editor, and
 * moveInstrumentation() keeps them through the decoration: those always win. This only runs
 * when the block arrives without them.
 * @param {Element} block
 */
function instrumentFallback(block) {
  if (block.dataset.aueResource) return;
  // One resource per block: a fragment is decorated before it is attached to the document
  // (indexOf is -1), so a detached block gets its own suffix, as in embed and media-text.
  const blockIndex = [...document.querySelectorAll('.breadcrumb')].indexOf(block);
  const position = blockIndex >= 0 ? blockIndex : `detached-${detachedCount += 1}`;
  const base = `urn:aemconnection:${window.location.pathname}#breadcrumb-${position}`;

  setMissing(block, {
    aueResource: base,
    aueType: 'container',
    aueFilter: 'breadcrumb',
    aueLabel: UE_LABELS.block,
    aueBehavior: 'component',
  });

  // Decorated levels, then the rows left in place because they have no label yet.
  const items = [...block.querySelectorAll(':scope > nav > ol > li, :scope > div')];
  items.forEach((item, index) => {
    const label = item.matches('li') ? item.querySelector('span') : item.children[0];
    setMissing(item, {
      aueResource: `${base}/item-${index}`,
      aueType: 'component',
      aueModel: 'breadcrumb-item',
      aueLabel: `${UE_LABELS.item}: ${label?.textContent.trim() || index + 1}`,
    });
    if (label && !label.dataset.aueProp) {
      setMissing(label, { aueProp: 'label', aueType: 'text', aueLabel: UE_LABELS.label });
    }
    const link = item.matches('li') ? item.querySelector(':scope > a[href]') : null;
    if (link && !link.dataset.aueProp) {
      setMissing(link, { aueProp: 'link', aueType: 'aem-content', aueLabel: UE_LABELS.link });
    }
  });
}

/**
 * Turns the authored rows into a navigation landmark with an ordered list of levels.
 * @param {Element} block - Root element of the block
 */
export default function decorate(block) {
  // Already decorated (decorate() ran twice on the same content): leave it as it is.
  if (block.querySelector(':scope > nav')) return;

  const rows = [...block.children];
  const items = rows.map(readItem).filter(Boolean);
  if (!items.length) {
    instrumentFallback(block);
    return;
  }

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', LABELS.nav);
  const list = document.createElement('ol');
  items.forEach((item, index) => list.append(buildItem(item, index === items.length - 1)));
  nav.append(list);

  // The consumed rows are empty shells now: their content and instrumentation live in the list
  // items. Rows without a label stay in place, so Universal Editor can still select and fill them.
  items.forEach(({ row }) => row.remove());
  block.append(nav);

  instrumentFallback(block);
}
