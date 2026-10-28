/**
 * Share Block — AEM Edge Delivery Services
 *
 * Contract: EDS-COMP-011 (.eds-pipeline/contracts/share.md)
 * Base: none (new block, no Block Collection reference)
 * Model: xwalk (EDS + Universal Editor)
 * UE instrumentation: Completado (Fase 3)
 * QA audit: Validado
 *
 * QA Changes:
 * - The authored row stays in place as the label (div.share-label > div > p): its text and
 *   the data-aue-* that AEM put on it are never moved, so there is no instrumentation to carry
 *   over. [ANTES] the row was emptied into a span and removed, and decorate() returned early
 *   on a second run, so a re-decoration of a block with a missing link kept it missing.
 * - The links are block configuration, not content: they live next to the authored row and
 *   are rebuilt on every decoration. decorate() is idempotent and a second run restores them.
 * - An empty label hides its row instead of leaving an empty box in the flex bar.
 * - Fallback data-aue-* only when AEM has not instrumented the block; never overwrites. One
 *   resource per block, also for blocks decorated inside a fragment before it is attached.
 * - Icons decode asynchronously (none of them is the LCP).
 * - Compact bar: on hover the circle takes the colour of its network (--color-<network>) and
 *   the icon turns white (EDS-FIX-002); focus is the global ring of styles.css.
 *
 * DOM de entrada (matriz EDS, contrato §3b):
 *   div.share[.compact]          (simple; classes → CSS class of the block, not a cell)
 *     └── div ← label  <div><p>text</p></div>   (optional)
 *
 * DOM de salida (contrato §3d, with the Google link next to the list as on the portal):
 *   div.share[.compact]
 *     ├── div.share-label > div > p              (the authored row, in place; hidden if empty)
 *     ├── ul[aria-labelledby | aria-label]
 *     │     └── li × 4 > a.share-link[target=_blank][aria-label] > span.icon > img[alt=""]
 *     └── a.share-link.share-source[target=_blank][aria-label]
 *           ├── span.icon.icon-google > img[alt=""]
 *           └── span.share-text                  (visible text)
 *
 * The networks are block configuration, not content (contract §1 and §10): Facebook, X,
 * LinkedIn and WhatsApp, plus "Add as preferred source on Google", with the URL patterns of
 * the portal (contract §10), built from the canonical URL and the title of the page.
 */

import { decorateIcons, toCamelCase } from '../../scripts/aem.js';

/**
 * Share networks in the portal order. `url` builds the link from the encoded page data.
 * WhatsApp carries the URL in the text: the portal sends the title alone, which shares nothing
 * the recipient can open (deviation from the portal, declared in the delivery).
 */
const NETWORKS = [
  { id: 'facebook', url: ({ url }) => `https://www.facebook.com/sharer/sharer.php?u=${url}` },
  { id: 'x', url: ({ url, title }) => `https://twitter.com/intent/tweet?text=${title}&url=${url}` },
  { id: 'linkedin', url: ({ url }) => `https://www.linkedin.com/sharing/share-offsite/?url=${url}` },
  { id: 'whatsapp', url: ({ url, title }) => `https://api.whatsapp.com/send?text=${title}%20${url}` },
];

/** Visible network names of the publication bar (1:1 portal: the X link still reads "Twitter"). */
const NETWORK_NAMES = {
  facebook: 'Facebook',
  x: 'Twitter',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
};

/** "Add as preferred source on Google", outside the list of networks as on the portal. */
const PREFERRED_SOURCE = {
  id: 'google',
  url: ({ url }) => `https://www.google.com/preferences/source?q=${url}`,
};

/**
 * Fallback interface texts, used only when the site placeholders do not define the keys.
 * The site texts live in /placeholders.json.
 */
const DEFAULT_LABELS = {
  shareLabel: 'Share',
  shareOnFacebook: 'Share on Facebook',
  shareOnX: 'Share on X',
  shareOnLinkedin: 'Share on LinkedIn',
  shareOnWhatsapp: 'Share on WhatsApp',
  sharePreferredSource: 'Add as preferred source on Google',
  opensInNewTab: 'opens in a new tab',
};

/** Universal Editor labels of the fallback instrumentation (fields of _share.json). */
const UE_LABELS = {
  block: 'Compartir',
  label: 'Etiqueta',
};

/** Placeholder key of the name of each link. */
const LABEL_KEYS = {
  facebook: 'shareOnFacebook',
  x: 'shareOnX',
  linkedin: 'shareOnLinkedin',
  whatsapp: 'shareOnWhatsapp',
  google: 'sharePreferredSource',
};

let placeholdersRequest;

/** Sequence for the ids of the labels (several share bars can live on one page). */
let labelCount = 0;

/** Sequence for the fallback Universal Editor resources (one per block). */
let instrumentedCount = 0;

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
 * Resolves an interface text: the site placeholder, or the English fallback.
 * @param {Object<string, string>} placeholders site placeholders
 * @param {string} key placeholder key
 * @returns {string}
 */
function getText(placeholders, key) {
  return placeholders[key] || placeholders[toCamelCase(key)] || DEFAULT_LABELS[key];
}

/**
 * URL and title of the page, encoded for a query string. The canonical URL wins over the
 * address bar (it drops tracking parameters); the hash is never shared.
 * @returns {{url: string, title: string}}
 */
function getPageData() {
  const canonical = document.querySelector('link[rel="canonical"]')?.href;
  const pageUrl = new URL(canonical || window.location.href);
  pageUrl.hash = '';
  const title = document.querySelector('meta[property="og:title"]')?.content || document.title;
  return {
    url: encodeURIComponent(pageUrl.href),
    title: encodeURIComponent(title.trim()),
  };
}

/**
 * Builds the link of one destination, opening in a new tab.
 * @param {{id: string, url: Function}} target entry of NETWORKS or PREFERRED_SOURCE
 * @param {{url: string, title: string}} page encoded page data
 * @param {string} iconName name of the icon in /icons
 * @returns {HTMLAnchorElement}
 */
function buildLink(target, page, iconName) {
  const link = document.createElement('a');
  link.className = 'share-link';
  link.href = target.url(page);
  link.target = '_blank';
  link.rel = 'noopener';
  link.dataset.network = target.id;

  const icon = document.createElement('span');
  icon.className = `icon icon-${iconName}`;
  link.append(icon);
  return link;
}

/**
 * Sets the interface texts: name of the list, names of the links (with the new-tab warning)
 * and the visible text of the Google link.
 * @param {Element} block the share block
 * @param {Object<string, string>} placeholders site placeholders ({} for the fallbacks)
 */
function applyTexts(block, placeholders) {
  const newTab = getText(placeholders, 'opensInNewTab');
  const list = block.querySelector(':scope > ul');
  if (!list.hasAttribute('aria-labelledby')) {
    list.setAttribute('aria-label', getText(placeholders, 'shareLabel'));
  }

  block.querySelectorAll('.share-link').forEach((link) => {
    const name = getText(placeholders, LABEL_KEYS[link.dataset.network]);
    link.setAttribute('aria-label', `${name} (${newTab})`);
    const visible = link.querySelector('.share-text');
    if (visible) visible.textContent = name;
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
 * Fallback instrumentation for Universal Editor. AEM delivers the data-aue-* attributes of the
 * block and of its label when the page is opened in the editor, and the label row is never
 * moved, so those always win. This only runs when the block arrives without them.
 * @param {Element} block
 * @param {?Element} row authored row of the label
 */
function instrumentFallback(block, row) {
  if (block.dataset.aueResource) return;
  // Order of decoration, not position in the document: blocks inside a fragment are decorated
  // before the fragment is attached, and a position lookup would give all of them the same id.
  instrumentedCount += 1;
  setMissing(block, {
    aueResource: `urn:aemconnection:${window.location.pathname}#share-${instrumentedCount}`,
    aueType: 'component',
    aueModel: 'share',
    aueLabel: UE_LABELS.block,
  });

  const cell = row?.firstElementChild;
  if (!cell || cell.querySelector('[data-aue-prop]') || cell.dataset.aueProp) return;
  setMissing(cell.querySelector(':scope > p') || cell, {
    aueProp: 'label',
    aueType: 'text',
    aueLabel: UE_LABELS.label,
  });
}

/**
 * Turns the optional label into the bar of share links.
 *
 * The authored row stays where EDS delivered it: it is the label. The list and the Google
 * link are generated from configuration and live next to it, outside the authored rows, so
 * they are rebuilt on every decoration and never depend on which fields the author filled.
 * @param {Element} block - Root element of the block
 */
export default function decorate(block) {
  // Generated by a previous decoration: rebuilt below from the configuration.
  block.querySelectorAll(':scope > ul, :scope > .share-source').forEach((node) => node.remove());

  const row = block.querySelector(':scope > div');
  const labelText = row?.textContent.trim() || '';
  // The compact bar sits on a light background: the icons keep the colour of each network.
  const iconSuffix = block.classList.contains('compact') ? '-brand' : '';
  const page = getPageData();

  const list = document.createElement('ul');
  NETWORKS.forEach((network) => {
    const item = document.createElement('li');
    const link = buildLink(network, page, `${network.id}${iconSuffix}`);
    const name = document.createElement('span');
    name.className = 'share-name';
    name.textContent = NETWORK_NAMES[network.id];
    link.append(name);
    item.append(link);
    list.append(item);
  });

  const source = buildLink(PREFERRED_SOURCE, page, PREFERRED_SOURCE.id);
  source.classList.add('share-source');
  const sourceText = document.createElement('span');
  sourceText.className = 'share-text';
  source.append(sourceText);

  if (row) {
    row.classList.add('share-label');
    row.hidden = !labelText;
    if (labelText) {
      if (!row.id) {
        labelCount += 1;
        row.id = `share-label-${labelCount}`;
      }
      list.setAttribute('aria-labelledby', row.id);
    }
  }

  // The links go right after the label row (or first, when the author left no row).
  if (row) row.after(list, source);
  else block.prepend(list, source);

  // Fallback texts right away, so no link is ever nameless; the site texts replace them.
  applyTexts(block, {});
  decorateIcons(block);
  // decorateIcons() already sets lazy loading and 16×16; none of the icons is the LCP.
  block.querySelectorAll('.icon img').forEach((img) => { img.decoding = 'async'; });
  instrumentFallback(block, row);
  fetchPlaceholders().then((placeholders) => applyTexts(block, placeholders));
}
