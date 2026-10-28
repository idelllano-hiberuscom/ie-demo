/**
 * Sticky CTA Block — AEM Edge Delivery Services
 *
 * Contract: EDS-COMP-016 (.eds-pipeline/contracts/sticky-cta.md)
 * Base: none (new block, no Block Collection reference)
 * Model: xwalk (EDS + Universal Editor)
 * UE instrumentation: ✅ Completado (Fase 3)
 * QA audit: ✅ Validado
 *
 * QA Changes:
 * - Rows are resolved by field, not by index (resolveFields): AEM emits no row for an empty
 *   field, so reading ROW[...] shifted every value when an optional field was left empty
 *   (contract §13.8, «vacíos u omitidos»).
 * - Universal Editor fallback instrumentation (instrumentBlock): only when AEM has not
 *   instrumented the block, never over the attributes AEM delivers. One resource per block.
 * - Contact Us shows the speech bubble icon of the portal (icons/comments.svg, decorative).
 * - reserveSpace() stops observing a block that left the document (Universal Editor replaces
 *   the block on every edit): the detached copy no longer resets the reserved space to 0.
 * - The TODO BLOQUEANTE on hover/active is now a note (orchestrator decision 1).
 * - [ANTES] the bar before it is shown and the folded CTAs were hidden only by CSS
 *   (visibility, scoped to .sticky-cta-container), with data-revealed/data-expanded.
 *   [DESPUÉS] both use the hidden attribute: what is not shown is not rendered, whatever
 *   CSS applies; the motion uses @keyframes and display allow-discrete.
 *
 * DOM de entrada (matriz EDS, contrato §3b — one field per row, in model order):
 *   div.sticky-cta
 *     ├── div > div > p                moreInfoLabel     (text of the toggle, required)
 *     ├── div > div > p                contactLabel
 *     ├── div > div > p > a[href]      contactLink       (mock URL set by the author)
 *     ├── div > div > p                brochureLabel
 *     ├── div > div > p > a[href]      brochureDocument  (PDF in the DAM, reference; a bare
 *     │                                                   path written as text is accepted)
 *     └── div > div > p                brochureName      (title of the PDF; was brochureTitle)
 *   An empty optional field may arrive as an empty row or as no row at all.
 *
 * DOM de salida (contrato §3d):
 *   div.sticky-cta[hidden until shown]
 *     ├── div.sticky-cta-bar                               (row 1, kept in place)
 *     │     └── button.sticky-cta-toggle[aria-expanded][aria-controls]
 *     │           ├── span                                 (moreInfoLabel)
 *     │           └── span.sticky-cta-icon[aria-hidden]    («+», drawn in CSS)
 *     └── ul.sticky-cta-actions#sticky-cta-actions-N[hidden][inert] (while folded)
 *           ├── li > a.sticky-cta-link[href]               (contactLink)
 *           │         ├── span                             (contactLabel)
 *           │         └── span.icon.icon-comments > img[alt=""]  (decorative)
 *           └── li > a.sticky-cta-link[href][download][title]  (brochureDocument)
 *                     ├── span                             (brochureLabel)
 *                     └── span.sticky-cta-context          (visually hidden)
 *                           «: <brochureName> (PDF)»
 *
 * Behaviour (contract §2 and §7, orchestrator decisions):
 * - MORE INFO is a toggle, not a link: it shows or hides the two CTAs without navigating,
 *   changing the hash, scrolling or opening a modal. A second click folds them.
 * - The bar shows by itself about 4 s after the page starts loading, as on the portal. It is
 *   position: fixed and reserves no space in the flow (no CLS); the entrance only animates
 *   opacity and transform, and not at all with prefers-reduced-motion.
 * - While shown, the page keeps a scroll-padding-bottom and a bottom padding equal to the
 *   height of the bar, so it never covers the focused element or the end of the page.
 *
 * NOTE [EDS-COMP-016]: contract §7 — the hover and active states of the toggle, Contact Us
 * and Download Brochure are «⚠️ NO EXTRAÍDO» (computed-styles.json only has the default
 * state). By decision of the orchestrator they are not invented: only focus-visible has its
 * own style; the cards keep their look on hover and active.
 *
 * @param {Element} block - Root element of the block
 */

import { decorateIcons, toCamelCase } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

/** Fields of the sticky-cta model, in model order (contract §3b / _sticky-cta.json). */
const FIELDS = [
  'moreInfoLabel',
  'contactLabel',
  'contactLink',
  'brochureLabel',
  'brochureDocument',
  'brochureName',
];

/**
 * Fallback interface texts, used only when the author left a label empty and the site
 * placeholders (/placeholders.json) do not define the key.
 */
const DEFAULT_LABELS = {
  stickyCtaMoreInfo: 'More info',
  stickyCtaContact: 'Contact us',
  stickyCtaBrochure: 'Download brochure',
};

/** Universal Editor labels of the fallback instrumentation (fields of _sticky-cta.json). */
const UE_LABELS = {
  block: 'Barra fija de CTA',
  moreInfoLabel: 'Texto del botón «More info»',
  contactLabel: 'Texto del enlace de contacto',
  contactLink: 'Enlace de contacto',
  brochureLabel: 'Texto del enlace del folleto',
  brochureDocument: 'Folleto (PDF del DAM)',
  brochureName: 'Título del folleto',
};

/** The portal shows the bar about 4 s after loading (contract §2, orchestrator decision). */
const REVEAL_DELAY_MS = 4000;

let placeholdersRequest;

/** Sequence for the ids of the action lists (aria-controls). */
let idCounter = 0;

/** Blocks instrumented by the fallback while detached from the document (fragments). */
let detachedCount = 0;

/**
 * Fetches the site placeholders once (/placeholders.json, rows Key/Text). Keys are available
 * as written and in camelCase. Any failure resolves to an empty object.
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
 * Tells whether a text is a path or a URL, not a human label.
 * @param {string} value
 * @returns {boolean}
 */
function isRawReference(value) {
  return /^(https?:|mailto:|tel:)|^\.{0,2}\/|\.pdf(\?|#|$)/i.test(value);
}

/**
 * Tells whether a row holds a link: an authored <a href>, or a bare path or URL as text.
 * @param {Element} row
 * @returns {boolean}
 */
function isLinkRow(row) {
  const cell = row.firstElementChild;
  if (!cell) return false;
  if (cell.querySelector('a[href]')) return true;
  const raw = cell.textContent.trim();
  return Boolean(raw) && isRawReference(raw);
}

/**
 * Tells whether a link row points to a document of the DAM (the brochure) rather than to a
 * page (the contact link).
 * @param {Element} row
 * @returns {boolean}
 */
function isDocumentRow(row) {
  const cell = row.firstElementChild;
  const href = cell.querySelector('a[href]')?.getAttribute('href') || cell.textContent.trim();
  return /\.pdf(\?|#|$)/i.test(href) || href.includes('/content/dam/');
}

/**
 * Field of a row as instrumented by AEM on the author instance, if any.
 * @param {Element} row
 * @returns {string|undefined}
 */
function instrumentedField(row) {
  const node = row.matches('[data-aue-prop]') ? row : row.querySelector('[data-aue-prop]');
  const prop = node?.dataset.aueProp;
  return FIELDS.includes(prop) ? prop : undefined;
}

/**
 * Resolves which row holds each field. AEM emits no row for an empty field, so the rows are
 * read by position only when all six are there. Otherwise, in this order:
 * 1. the data-aue-prop AEM puts on each field on the author instance;
 * 2. the content: moreInfoLabel is required and always first; the links anchor the rest
 *    (two links: contact, then brochure; one link: brochure when it is a PDF or a DAM path),
 *    and each label is the text right before its link; brochureName comes after the
 *    brochure. A label whose link is missing is not shown, so its slot does not matter.
 * @param {Element[]} rows
 * @returns {Object<string, Element|undefined>} row per field
 */
function resolveFields(rows) {
  if (rows.length === FIELDS.length) {
    return Object.fromEntries(FIELDS.map((field, index) => [field, rows[index]]));
  }

  const byProp = rows.map(instrumentedField);
  if (rows.length && byProp.every(Boolean)) {
    return Object.fromEntries(rows.map((row, index) => [byProp[index], row]));
  }

  const fields = { moreInfoLabel: rows[0] };
  const rest = rows.slice(1);
  const links = rest.filter(isLinkRow);
  if (links.length >= 2) {
    [fields.contactLink, fields.brochureDocument] = links;
  } else if (links.length === 1) {
    const [link] = links;
    fields[isDocumentRow(link) ? 'brochureDocument' : 'contactLink'] = link;
  }

  const texts = rest.filter((row) => !links.includes(row));
  const between = (from, to) => texts.filter((row) => {
    const index = rows.indexOf(row);
    return index > from && index < to;
  });
  const contactAt = rows.indexOf(fields.contactLink);
  const documentAt = rows.indexOf(fields.brochureDocument);

  if (contactAt > 0) {
    fields.contactLabel = between(0, contactAt).at(-1);
    if (documentAt > 0) fields.brochureLabel = between(contactAt, documentAt).at(-1);
  } else if (documentAt > 0) {
    const labels = between(0, documentAt);
    fields.brochureLabel = labels.at(-1);
    if (labels.length > 1) fields.contactLabel = labels.at(-2);
  }
  if (documentAt > 0) [fields.brochureName] = between(documentAt, rows.length);
  return fields;
}

/**
 * Moves the authored text of a row into a new element, with the instrumentation of its cell
 * and paragraph, so the authored nodes are reused and not copied.
 * @param {Element} [row]
 * @param {Element} target element that receives the text
 * @returns {boolean} whether the row had text
 */
function moveText(row, target) {
  const cell = row?.firstElementChild;
  if (!cell?.textContent.trim()) return false;
  const source = cell.querySelector(':scope > p') || cell;
  moveInstrumentation(cell, target);
  if (source !== cell) moveInstrumentation(source, target);
  target.append(...source.childNodes);
  return true;
}

/**
 * Returns the authored link of a row (<p><a href>), or builds one from a bare path or URL
 * written as text. The instrumentation of the cell and paragraph moves to the link.
 * @param {Element} [row]
 * @returns {HTMLAnchorElement|null}
 */
function takeLink(row) {
  const cell = row?.firstElementChild;
  if (!cell) return null;

  let link = cell.querySelector('a[href]');
  if (!link) {
    const raw = cell.textContent.trim();
    if (!raw || !isRawReference(raw)) return null;
    link = document.createElement('a');
    link.href = raw;
  }

  const holder = link.closest('p');
  moveInstrumentation(cell, link);
  if (holder && holder !== cell) moveInstrumentation(holder, link);

  // decorateButtons() copies the link text (the raw reference) into an empty title.
  const title = (link.getAttribute('title') || '').trim();
  if (title && (title === link.getAttribute('href') || isRawReference(title))) {
    link.removeAttribute('title');
  }
  link.className = 'sticky-cta-link';
  link.textContent = '';
  return link;
}

/**
 * POC shortcut, 1:1 with the portal: a CTA whose label is authored but whose link is empty
 * still shows, and opens the form of the page (#form), as the portal opens its Marketo form.
 * @param {Element} [labelRow]
 * @returns {HTMLAnchorElement|null}
 */
function formLink(labelRow) {
  if (!labelRow?.textContent.trim() || !document.getElementById('form')) return null;
  const link = document.createElement('a');
  link.href = '#form';
  link.className = 'sticky-cta-link';
  return link;
}

/**
 * Tells whether a link points to a PDF.
 * @param {HTMLAnchorElement} link
 * @returns {boolean}
 */
function isPdf(link) {
  const href = link.getAttribute('href');
  try {
    return /\.pdf$/i.test(new URL(href, window.location.href).pathname);
  } catch {
    return /\.pdf(\?|#|$)/i.test(href);
  }
}

/**
 * Builds the visible text of a CTA from its authored label, or from the fallback text when
 * the author left it empty.
 * @param {Element} [labelRow]
 * @param {string} fallbackKey placeholder key of the fallback text
 * @param {Array<[Element, string]>} fallbacks collects the elements that use a fallback
 * @returns {HTMLSpanElement}
 */
function buildText(labelRow, fallbackKey, fallbacks) {
  const text = document.createElement('span');
  if (!moveText(labelRow, text)) {
    text.textContent = DEFAULT_LABELS[fallbackKey];
    fallbacks.push([text, fallbackKey]);
  }
  return text;
}

/**
 * Decorates the brochure link as a download, as the accordion does with its PDFs (R7):
 * visible text brochureLabel, title attribute brochureName and accessible name
 * «<brochureLabel>: <brochureName> (PDF)».
 * @param {HTMLAnchorElement} link
 * @param {Element} [titleRow]
 * @returns {HTMLSpanElement|null} the node that shows brochureName, if it has one
 */
function decorateDownload(link, titleRow) {
  const pdf = isPdf(link);
  if (pdf) link.setAttribute('download', '');

  const titleText = document.createElement('span');
  const hasTitle = moveText(titleRow, titleText);
  const linkTitle = hasTitle ? titleText.textContent.trim() : link.getAttribute('title');
  if (linkTitle) link.title = linkTitle;
  if (!hasTitle && !pdf) return null;

  const context = document.createElement('span');
  context.className = 'sticky-cta-context';
  if (hasTitle) context.append(': ', titleText);
  if (pdf) context.append(' (PDF)');
  link.append(context);
  return hasTitle ? titleText : null;
}

/**
 * Builds the list item of one CTA, or nothing when its link is missing.
 * @param {HTMLAnchorElement|null} link
 * @param {HTMLSpanElement} text
 * @returns {HTMLLIElement|null}
 */
function buildItem(link, text) {
  if (!link) return null;
  link.prepend(text);
  const item = document.createElement('li');
  item.append(link);
  return item;
}

/**
 * Adds the decorative speech bubble of the portal after the text of Contact Us.
 * decorateIcons() gives it alt="", lazy loading and 16×16 intrinsic size (no CLS).
 * @param {HTMLAnchorElement} link
 */
function addContactIcon(link) {
  const icon = document.createElement('span');
  icon.className = 'icon icon-comments';
  link.append(icon);
  decorateIcons(link);
}

/**
 * Shows or folds the two CTAs. While folded they are hidden (not rendered) and inert, so they
 * also leave the tab order while they slide back behind the bar.
 * @param {HTMLButtonElement} toggle
 * @param {HTMLUListElement} list
 * @param {boolean} expanded
 */
function setExpanded(toggle, list, expanded) {
  toggle.setAttribute('aria-expanded', String(expanded));
  list.hidden = !expanded;
  list.inert = !expanded;
}

/**
 * Keeps the end of the page and the focused element clear of the bar: scroll-padding-bottom
 * and a bottom padding equal to the space the bar takes from the bottom of the viewport.
 * The value is measured (it changes with the breakpoint), so it is set from here.
 * @param {Element} block
 */
function reserveSpace(block) {
  const observer = new ResizeObserver(() => {
    // Universal Editor replaces the block on every edit: the old copy must not reset the
    // space the new one reserves.
    if (!block.isConnected) {
      observer.disconnect();
      return;
    }
    const bottom = parseFloat(getComputedStyle(block).bottom) || 0;
    const reserve = `${Math.ceil(block.offsetHeight + bottom)}px`;
    document.documentElement.style.scrollPaddingBottom = reserve;
    document.body.style.paddingBottom = reserve;
  });
  observer.observe(block);
}

/**
 * Shows the bar about 4 s after the page started loading. The bar is fixed and hidden until
 * then, so showing it moves nothing in the page.
 * @param {Element} block
 */
function scheduleReveal(block) {
  const wait = Math.max(0, REVEAL_DELAY_MS - performance.now());
  setTimeout(() => {
    block.hidden = false;
    reserveSpace(block);
  }, wait);
}

/**
 * Sets the data-aue-* of one field, unless the element already has a property.
 * @param {?Element} element node that shows the field
 * @param {string} prop data-aue-prop (field name in models[])
 * @param {string} type data-aue-type
 */
function instrumentField(element, prop, type) {
  if (!element || element.dataset.aueProp) return;
  element.dataset.aueProp = prop;
  element.dataset.aueType = type;
  element.dataset.aueLabel = UE_LABELS[prop];
}

/**
 * Universal Editor instrumentation (xwalk). On the author instance AEM delivers the block
 * already instrumented with the real resource of the component: those attributes travel with
 * the nodes decorate() moves (moveInstrumentation) and are never overwritten. Only a block
 * AEM has not instrumented (local drafts, preview) gets this fallback, with a resource built
 * from the current path and the position of the block in the page.
 * A field whose link is missing does not render, and is edited from the properties panel.
 * @param {Element} block
 * @param {Object<string, ?Element>} nodes node that shows each field
 */
function instrumentBlock(block, nodes) {
  if (block.dataset.aueResource) return;
  // One resource per block: Universal Editor looks blocks up by data-aue-resource. A fragment
  // is decorated before it is attached to the document (indexOf is -1), so a detached block
  // gets its own suffix instead of taking the resource of the first block of the page.
  const position = [...document.querySelectorAll('.sticky-cta')].indexOf(block);
  const suffix = position >= 0 ? position : `detached-${detachedCount += 1}`;
  block.dataset.aueResource = `urn:aemconnection:${window.location.pathname}#sticky-cta-${suffix}`;
  block.dataset.aueType = 'component';
  block.dataset.aueModel = 'sticky-cta';
  block.dataset.aueLabel = UE_LABELS.block;

  instrumentField(nodes.moreInfoLabel, 'moreInfoLabel', 'text');
  instrumentField(nodes.contactLabel, 'contactLabel', 'text');
  instrumentField(nodes.contactLink, 'contactLink', 'aem-content');
  instrumentField(nodes.brochureLabel, 'brochureLabel', 'text');
  instrumentField(nodes.brochureDocument, 'brochureDocument', 'media');
  instrumentField(nodes.brochureName, 'brochureName', 'text');
}

/**
 * Turns the authored rows into the fixed bar: the MORE INFO toggle and the two CTAs it
 * shows and folds.
 * @param {Element} block - Root element of the block
 */
export default function decorate(block) {
  if (block.querySelector('.sticky-cta-toggle')) return;

  const rows = [...block.querySelectorAll(':scope > div')];
  const field = resolveFields(rows);
  const fallbacks = [];

  // MORE INFO: the first row stays as the bar and holds the toggle.
  const bar = rows[0] || document.createElement('div');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sticky-cta-toggle';
  const label = document.createElement('span');
  if (!moveText(field.moreInfoLabel, label)) {
    label.textContent = DEFAULT_LABELS.stickyCtaMoreInfo;
    fallbacks.push([label, 'stickyCtaMoreInfo']);
  }
  const icon = document.createElement('span');
  icon.className = 'sticky-cta-icon';
  icon.setAttribute('aria-hidden', 'true');
  toggle.append(label, icon);
  bar.querySelectorAll(':scope > div').forEach((cell) => cell.remove());
  bar.className = 'sticky-cta-bar';
  bar.append(toggle);

  // CONTACT US and DOWNLOAD BROCHURE, in the portal order.
  const contactLink = takeLink(field.contactLink) || formLink(field.contactLabel);
  const contactText = buildText(field.contactLabel, 'stickyCtaContact', fallbacks);
  const contact = buildItem(contactLink, contactText);
  if (contactLink) addContactIcon(contactLink);

  const brochureLink = takeLink(field.brochureDocument) || formLink(field.brochureLabel);
  const brochureName = brochureLink
    ? decorateDownload(brochureLink, field.brochureName)
    : null;
  const brochureText = buildText(field.brochureLabel, 'stickyCtaBrochure', fallbacks);
  const brochure = buildItem(brochureLink, brochureText);

  idCounter += 1;
  const list = document.createElement('ul');
  list.className = 'sticky-cta-actions';
  list.id = `sticky-cta-actions-${idCounter}`;
  list.append(...[contact, brochure].filter(Boolean));
  toggle.setAttribute('aria-controls', list.id);

  // The other rows are empty now: their text, links and instrumentation have moved.
  rows.slice(1).forEach((row) => row.remove());
  if (!bar.parentElement) block.append(bar);
  bar.after(list);

  instrumentBlock(block, {
    moreInfoLabel: label,
    contactLabel: contact ? contactText : null,
    contactLink,
    brochureLabel: brochure ? brochureText : null,
    brochureDocument: brochureLink,
    brochureName,
  });

  setExpanded(toggle, list, false);
  toggle.addEventListener('click', () => {
    setExpanded(toggle, list, toggle.getAttribute('aria-expanded') !== 'true');
  });

  block.hidden = true;
  scheduleReveal(block);

  if (fallbacks.length) {
    fetchPlaceholders().then((placeholders) => {
      fallbacks.forEach(([element, key]) => {
        const text = placeholders[key] || placeholders[toCamelCase(key)];
        if (text) element.textContent = text;
      });
    });
  }
}
