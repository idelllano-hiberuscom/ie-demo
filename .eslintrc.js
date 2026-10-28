module.exports = {
  root: true,
  extends: [
    'airbnb-base',
    'plugin:json/recommended',
    'plugin:xwalk/recommended',
  ],
  env: {
    browser: true,
  },
  parser: '@babel/eslint-parser',
  parserOptions: {
    allowImportExportEverywhere: true,
    sourceType: 'module',
    requireConfigFile: false,
  },
  rules: {
    'import/extensions': ['error', { js: 'always' }], // require js file extensions in imports
    'linebreak-style': ['error', 'unix'], // enforce unix linebreaks
    'no-param-reassign': [2, { props: false }], // allow modifying properties of param
    // Límite de celdas por modelo (decisión de la persona, 2026-10-28, opción B):
    // los modelos de los contratos aprobados en el Gate 2 superan las 4 celdas por defecto
    // y no se agrupan con prefijos en la POC. El resto de modelos sigue limitado a 4.
    // Agrupar elementos (media_*, content_*) queda como evolutivo.
    'xwalk/max-cells': ['error', {
      '*': 4,
      hero: 7,
      card: 12,
      'media-text': 8,
      'tabs-item': 5,
      'accordion-item': 10,
      'form-field': 6,
      'sticky-cta': 6,
    }],
  },
};
