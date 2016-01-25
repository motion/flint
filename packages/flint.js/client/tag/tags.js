// from https://github.com/facebook/react/blob/401e6f10587b09d4e725763984957cf309dfdc30/src/isomorphic/classic/element/ReactDOMFactories.js

/* TODO! What is the purpose? Native array is faster, or for V8 use switch on length

  llustrated below is the fastest method. Second method is to use array, else the slow on - current

  Example:
  function getTagName(tag) {

 switch ( tag.length) {
    case 4: return tag === 'abbr' || tag === 'area'
    case 5: return tag === 'aside'
   }
 }

  Usage:

   let tag = 'abbr';

   if ( getTagName(tag)) { // Will match 'abbr'
    // Do your stuff...
   }

 */
export default {
  a: true,
  abbr: true,
  address: true,
  area: true,
  article: true,
  aside: true,
  audio: true,
  b: true,
  base: true,
  bdi: true,
  bdo: true,
  big: true,
  blockquote: true,
  body: true,
  br: true,
  button: true,
  canvas: true,
  caption: true,
  cite: true,
  code: true,
  col: true,
  colgroup: true,
  data: true,
  datalist: true,
  dd: true,
  del: true,
  details: true,
  dfn: true,
  dialog: true,
  div: true,
  dl: true,
  dt: true,
  em: true,
  embed: true,
  fieldset: true,
  figcaption: true,
  figure: true,
  footer: true,
  form: true,
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
  head: true,
  header: true,
  hgroup: true,
  hr: true,
  html: true,
  i: true,
  iframe: true,
  img: true,
  input: true,
  ins: true,
  kbd: true,
  keygen: true,
  label: true,
  legend: true,
  li: true,
  link: true,
  main: true,
  map: true,
  mark: true,
  menu: true,
  menuitem: true,
  meta: true,
  meter: true,
  nav: true,
  noscript: true,
  object: true,
  ol: true,
  optgroup: true,
  option: true,
  output: true,
  p: true,
  param: true,
  picture: true,
  pre: true,
  progress: true,
  q: true,
  rp: true,
  rt: true,
  ruby: true,
  s: true,
  samp: true,
  script: true,
  section: true,
  select: true,
  small: true,
  source: true,
  span: true,
  strong: true,
  style: true,
  sub: true,
  summary: true,
  sup: true,
  table: true,
  tbody: true,
  td: true,
  textarea: true,
  tfoot: true,
  th: true,
  thead: true,
  time: true,
  title: true,
  tr: true,
  track: true,
  u: true,
  ul: true,
  true,
  video: true,
  wbr: true,

  // SVG
  circle: true,
  clipPath: true,
  defs: true,
  ellipse: true,
  g: true,
  image: true,
  line: true,
  linearGradient: true,
  mask: true,
  path: true,
  pattern: true,
  polygon: true,
  polyline: true,
  radialGradient: true,
  rect: true,
  stop: true,
  svg: true,
  text: true,
  tspan: true,

 // TODO! What about MATHML ?

}