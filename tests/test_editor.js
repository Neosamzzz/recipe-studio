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
  McItemAnimation: require('../icon-animation.js'), structuredClone, items: [], itemCategories: [], recentItems: [], itemExpanded: new Map(),
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

const animatedProject = {
  version: 3, items: [{id: 'a', name: 'Animated', type: 'part', color: '#ffffff',
    icon: 'data:image/png;base64,AA==', iconAnimation: {animation: {frametime: 3, frames: [0, 1]}}}],
  itemCategories: [{path: ['材料'], ids: ['a']}], objects: [], templates: [], recipes: [], files: [],
  recentItems: [], hiddenExamples: [], camera: {x: 0, y: 0, z: 1},
};
applyScope.applyProject(animatedProject);
assert.equal(applyScope.items[0].iconAnimation.animation.frametime, 3);
console.log('Passed: browser project loading preserves animation metadata');

// History uses the same project loader as API/import, while retaining the current view.
const historyEvents = new Map();
const historyScope = {
  structuredClone, queueMicrotask, setTimeout, Set, Map, JSON,
  project: {version: 3, items: [{id: 'a', name: 'A'}], objects: [{id: 'o1', x: 0}],
    templates: [], recipes: [], files: [], itemCategories: [], recentItems: [], hiddenExamples: [], camera: {x: 0,y: 0,z: 1}},
  camera: {x: 80,y: 20,z: 2}, pointerInteraction: false, selection: new Set(['o1']),
  selectionOrigin: 'marquee', inspectedItem: 'a', view: 'a', pendingDrafts: new Set(),
  document: {activeElement: {tagName: 'BODY'}, querySelector: () => null,
    addEventListener: (type, fn) => historyEvents.set(type, fn)},
  window: {addEventListener: (type, fn) => historyEvents.set(type, fn)},
  hideMenu() {}, renderWorld() {}, renderProps() {}, renderPreview() {}, stat() {},
};
historyScope.projectSnapshot = () => structuredClone(historyScope.project);
historyScope.applyProject = p => {historyScope.project = structuredClone(p); historyScope.camera = p.camera; historyScope.selection.clear(); historyScope.inspectedItem = null;};
historyScope.itemBy = id => historyScope.project.items.find(i => i.id === id);
Object.defineProperty(historyScope, 'objects', {get: () => historyScope.project.objects});
vm.createContext(historyScope);
const historyStart = html.indexOf('function historySnapshot(');
assert(historyStart >= 0, 'Undo history is missing');
vm.runInContext(html.slice(historyStart, html.indexOf('const pendingDrafts=', historyStart)), historyScope);
vm.runInContext('resetHistory()', historyScope);
historyScope.project.objects[0].x = 10;
historyScope.checkpointHistory();
historyScope.project.objects[0].x = 20;
historyScope.checkpointHistory();
assert.equal(historyScope.stepHistory(-1), true);
assert.equal(historyScope.project.objects[0].x, 10);
assert.equal(historyScope.camera.z, 2, 'Undo preserves pan and zoom');
assert.equal(historyScope.inspectedItem, 'a', 'Undo retains Item inspection');
assert.equal(historyScope.stepHistory(1), true);
assert.equal(historyScope.project.objects[0].x, 20);
historyScope.stepHistory(-1);
historyScope.project.items[0].name = 'New name';
historyScope.checkpointHistory();
assert.equal(historyScope.stepHistory(1), false, 'Editing after undo clears redo');
historyScope.stepHistory(-1);
assert.equal(historyScope.project.items[0].name, 'A');
historyScope.project.camera = {x: 999,y: 999,z: 1};
historyScope.checkpointHistory();
historyScope.stepHistory(-1);
assert.equal(historyScope.project.objects[0].x, 0, 'Camera-only changes add no history');
historyScope.resetHistory();
historyScope.pointerInteraction = true;
for (let x = 1; x <= 10; x++) {historyScope.project.objects[0].x = x; historyScope.checkpointHistory();}
historyScope.pointerInteraction = false;
historyScope.checkpointHistory();
historyScope.stepHistory(-1);
assert.equal(historyScope.project.objects[0].x, 0, 'Whole drag is one step');
assert.equal(historyScope.stepHistory(-1), false);
// External changes are one undoable step, but initial loading resets history.
historyScope.project.items[0].name = 'AI name';
historyScope.checkpointHistory();
historyScope.stepHistory(-1);
assert.equal(historyScope.project.items[0].name, 'A');
historyScope.project.items[0].name = 'Loaded';
historyScope.resetHistory();
assert.equal(historyScope.stepHistory(-1), false);
let prevented = false;
const shortcut = {key: 'z', ctrlKey: true, preventDefault() {prevented = true;}};
historyScope.project.items[0].name = 'Edit';historyScope.checkpointHistory();
historyScope.document.activeElement = {tagName: 'INPUT'};
historyScope.historyKeydown(shortcut);
assert.equal(prevented, false, 'Text inputs retain native undo');
assert.equal(historyScope.project.items[0].name, 'Edit');
historyScope.document.activeElement = {tagName: 'DIV', isContentEditable: true};
historyScope.historyKeydown(shortcut);
assert.equal(prevented, false, 'Contenteditable retains native undo');
historyScope.document.activeElement = {tagName: 'BODY'};
historyScope.historyKeydown(shortcut);
assert.equal(prevented, true);
assert.equal(historyScope.project.items[0].name, 'Loaded');
historyScope.historyKeydown({...shortcut, ctrlKey: false, metaKey: true, shiftKey: true});
assert.equal(historyScope.project.items[0].name, 'Edit');
console.log('Passed: undo/redo, branch clearing, drag transactions, API edits, view preservation and native text undo');

// Exercise the real loader with bundled assets and recipes, including animation metadata.
Object.assign(applyScope, {queueMicrotask, setTimeout, window: {addEventListener() {}},
  pointerInteraction: false, selectionOrigin: 'none', pendingDrafts: new Set(), hideMenu() {}, stat() {}});
vm.runInContext(html.slice(historyStart, html.indexOf('const pendingDrafts=', historyStart)), applyScope);
vm.runInContext(loadFunction('projectSnapshot', 'collectProject').split('const assetDataCache=')[0], applyScope);
applyScope.applyProject({...animatedProject, files: [{path: '界面/crafting.svg', src: 'assets/crafting.svg'}]}, true);
applyScope.resetHistory();
applyScope.items[0].name = 'Changed';applyScope.checkpointHistory();
applyScope.stepHistory(-1);
assert.equal(applyScope.items[0].name, 'Animated');
assert.equal(applyScope.files[0].src, 'assets/crafting.svg');
applyScope.stepHistory(1);
assert.equal(applyScope.items[0].name, 'Changed');
assert.equal(applyScope.items[0].iconAnimation.animation.frametime, 3);
console.log('Passed: real history restoration preserves bundled files and animated icons');

// Run the actual reconciliation and save path: API update -> undo -> PUT with current revision.
vm.runInContext("let apiRevision=1,apiReady=true,apiBusy=false,apiBaseline=JSON.stringify(projectSnapshot()),apiStartupSignature='';", historyScope);
const syncStart = html.indexOf('async function syncProject(');
vm.runInContext(html.slice(syncStart, html.indexOf("let apiStartupSignature=", syncStart)), historyScope);
let remoteProject = structuredClone(historyScope.project), remoteRevision = 2;
remoteProject.items[0].name = 'API edit';
historyScope.apiCall = async () => ({revision: remoteRevision, project: structuredClone(remoteProject)});
historyScope.syncStatus = () => {};
historyScope.pushProject = async (revision, raw) => {
  assert.equal(revision, remoteRevision, 'Undo saves with the latest API revision');
  remoteProject = structuredClone(raw);remoteRevision++;
  vm.runInContext('apiRevision='+remoteRevision+';apiBaseline=JSON.stringify(projectSnapshot());', historyScope);
};
(async () => {
  historyScope.resetHistory();
  await historyScope.syncProject();
  assert.equal(historyScope.project.items[0].name, 'API edit');
  historyScope.stepHistory(-1);
  assert.equal(historyScope.project.items[0].name, 'Edit');
  await historyScope.syncProject();
  assert.equal(remoteProject.items[0].name, 'Edit', 'Undo is persisted back to API');
  historyScope.stepHistory(1);
  assert.equal(historyScope.project.items[0].name, 'API edit');
  console.log('Passed: external API edit is undoable and undo persists without losing redo');
})().catch(error => {console.error(error);process.exitCode = 1;});
