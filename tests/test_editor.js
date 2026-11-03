const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function loadFunction(name, next) {
  const start = html.indexOf('function ' + name + '(');
  assert(start >= 0, name + ' is missing');
  return html.slice(start, html.indexOf('function ' + next + '(', start));
}
const scope = {};
vm.createContext(scope);
vm.runInContext(loadFunction('recipeIssues', 'resizeDimensions'), scope);
vm.runInContext(loadFunction('resizeDimensions', 'resizeImage'), scope);
const slot = (role, item) => ({type: 'slot', role, item, qty: 1});
assert.match(scope.recipeIssues([slot('input', 'a')]).error, /输出/);
assert.match(scope.recipeIssues([slot('output', null)]).error, /输出/);
assert.equal(scope.recipeIssues([slot('output', 'a')]).error, null);
assert.equal(scope.recipeIssues([slot('output', 'a'), {type: 'item', item: 'b'}]).loose, 1);
let size = scope.resizeDimensions({w: 200, h: 100}, 400, 100, true, 'w');
assert.equal(size.w, 400);
assert.equal(size.h, 200);
size = scope.resizeDimensions({w: 200, h: 100}, 400, 170, false, 'w');
assert.equal(size.w, 400);
assert.equal(size.h, 170);
console.log('Passed: missing output, empty output, valid output, loose Item warning, proportional and free resizing');
const notices = [];
const dialogScope = {
  objects: [], selection: new Set(), saveKind: null, saving: [],
  recipeIssues: scope.recipeIssues,
  showNotice: async (...args) => { notices.push(args); return false; },
};
vm.createContext(dialogScope);
const saveStart = html.indexOf('async function nameSave(');
vm.runInContext(html.slice(saveStart, html.indexOf("$('cancel-name')", saveStart)), dialogScope);
(async () => {
  await dialogScope.nameSave('recipe', [slot('input', 'a')]);
  assert.equal(notices[0][0], '配方缺少输出');
  notices.length = 0;
  await dialogScope.nameSave('recipe', [slot('output', 'a'), {type: 'item', item: 'b'}]);
  assert.equal(notices[0][0], '存在未归位的 Item');
  console.log('Passed: validation opens the correct dialog before saving');
})().catch(error => { console.error(error); process.exitCode = 1; });
const deleteEntry = {name: 'Test', objects: []};
const deleteScope = {
  current: {saved: deleteEntry}, recipes: [deleteEntry], hiddenExamples: new Set(),
  view: 'a', index: 0, previewIndex: new Map(), itemBy: () => ({name: 'A'}),
  showNotice: async () => false, renderLibrary() {}, renderPreview() {}, renderProps() {}, stat() {},
};
vm.createContext(deleteScope);
const deleteStart = html.indexOf('remove.onclick=') + 'remove.onclick='.length;
vm.runInContext('handleDelete=' + html.slice(deleteStart, html.indexOf(';controls.append(remove)', deleteStart)), deleteScope);
(async () => {
  await deleteScope.handleDelete();
  assert.equal(deleteScope.recipes.length, 1, 'Cancel must preserve the recipe');
  deleteScope.showNotice = async () => true;
  await deleteScope.handleDelete();
  assert.equal(deleteScope.recipes.length, 0, 'Confirm must delete only the current recipe');
  console.log('Passed: recipe deletion requires positive confirmation');
})().catch(error => { console.error(error); process.exitCode = 1; });
const validStart = html.indexOf('function valid(o){', html.indexOf('function applyProject('));
const validEnd = html.indexOf('if(![2,3].includes', validStart);
const imageScope = {loadedBy: () => true};
vm.createContext(imageScope);
vm.runInContext(html.slice(validStart, validEnd), imageScope);
for (const src of ['data:image/png;base64,AA==', 'assets/crafting.svg', 'assets/processor.svg']) {
  assert.equal(imageScope.valid({id: 'image', type: 'image', x: 0, y: 0, w: 100, h: 50, src}), true);
}
assert.equal(imageScope.valid({id: 'image', type: 'image', x: 0, y: 0, w: 100, h: 50, src: '/.git/config'}), false);
console.log('Passed: browser accepts API-supported image sources and rejects unrelated paths');
const applyScope = {
  structuredClone, items: [], itemCategories: [], recentItems: [], itemExpanded: new Map(),
  inspectedItem: null, view: 'a', serial: 0, templates: [], recipes: [],
  hiddenExamples: new Set(), previewIndex: new Map(), files: [], selection: new Set(),
  renderItems() {}, renderRecentItems() {}, renderFiles() {}, renderLibrary() {},
  renderWorld() {}, renderProps() {}, renderPreview() {},
};
applyScope.itemBy = id => applyScope.items.find(item => item.id === id);
vm.createContext(applyScope);
const applyStart = html.indexOf('function applyProject(');
vm.runInContext(html.slice(applyStart, html.indexOf("$('save-project').onclick=", applyStart)), applyScope);
applyScope.applyProject({
  version: 3, items: [{id: 'a', name: 'A', type: 'part', color: '#ffffff'}],
  itemCategories: [{path: ['材料'], ids: ['a']}], recentItems: [],
  hiddenExamples: ['custom-id'], objects: [{id: 'o99', type: 'image', x: 0, y: 0, w: 100, h: 50,
    src: 'assets/crafting.svg'}], templates: [], recipes: [], files: [], camera: {x: 0, y: 0, z: 1},
});
assert.equal(applyScope.objects[0].src, 'assets/crafting.svg');
assert.equal(applyScope.hiddenExamples.has('custom-id'), true);
console.log('Passed: complete API project with bundled image and unknown hidden example can be restored');
