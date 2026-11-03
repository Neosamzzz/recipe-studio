#!/usr/bin/env python3
"""Local project storage and revisioned HTTP API for Recipe Studio."""
import argparse
import copy
import http.server
import json
import math
import os
import threading
import webbrowser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
RESOURCES = {'items': 'items', 'categories': 'itemCategories', 'objects': 'objects',
             'recipes': 'recipes', 'templates': 'templates', 'files': 'files'}


def validate(project):
    def require(condition, message):
        if not condition:
            raise ValueError(message)

    def number(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

    require(isinstance(project, dict) and project.get('version') == 3, '工程 version 必须为 3')
    for key in RESOURCES.values():
        require(isinstance(project.get(key), list), f'{key} 必须是数组')
    items = project['items']
    require(bool(items), 'Item 库不能为空')
    ids = set()
    for item in items:
        require(isinstance(item, dict), 'Item 必须是对象')
        require(isinstance(item.get('id'), str) and bool(item['id']) and item['id'] not in ids,
                'Item ID 必须非空且唯一')
        ids.add(item['id'])
        require(isinstance(item.get('name'), str) and bool(item['name'].strip()), 'Item 名称不能为空')
        require(item.get('type') in ('ore', 'ingot', 'plate', 'part'), 'Item type 不受支持')
        require(isinstance(item.get('color'), str), 'Item color 必须是字符串')
        require(not item.get('icon') or isinstance(item['icon'], str) and item['icon'].startswith('data:image/'),
                '图标必须使用内嵌图片 data URL')
    for category in project['itemCategories']:
        require(isinstance(category, dict) and isinstance(category.get('path'), list)
                and bool(category['path']) and all(isinstance(v, str) and v.strip() for v in category['path']),
                '分类 path 必须是非空名称数组')
        require(isinstance(category.get('ids'), list) and all(i in ids for i in category['ids']),
                '分类引用了不存在的 Item')

    def objects_valid(objects, label):
        require(isinstance(objects, list), label + ' objects 必须是数组')
        seen = set()
        for obj in objects:
            require(isinstance(obj, dict) and obj.get('type') in ('image', 'slot', 'item'), label + ' 对象类型无效')
            require(isinstance(obj.get('id'), str) and obj['id'] not in seen, label + ' 对象 ID 必须唯一')
            seen.add(obj['id'])
            require(all(number(obj.get(k)) for k in ('x', 'y', 'w', 'h'))
                    and obj['w'] > 0 and obj['h'] > 0, label + ' 坐标或尺寸无效')
            if obj['type'] == 'image':
                require(isinstance(obj.get('src'), str) and (obj['src'].startswith('data:image/')
                        or obj['src'] in ('assets/crafting.svg', 'assets/processor.svg')), label + ' 图片来源无效')
            else:
                require(not obj.get('item') or obj['item'] in ids, label + ' 引用了不存在的 Item')
                require(number(obj.get('qty')) and int(obj['qty']) == obj['qty'] and 1 <= obj['qty'] <= 999,
                        label + ' 数量必须为 1–999 的整数')
                if obj['type'] == 'slot':
                    require(obj.get('role') in ('input', 'output'), label + ' 槽位 role 无效')
                else:
                    require(obj.get('item') in ids, label + ' 游离 Item 不能为空')
    objects_valid(project['objects'], '工作区')
    warnings = []
    for key in ('templates', 'recipes'):
        for entry in project[key]:
            require(isinstance(entry, dict) and isinstance(entry.get('name'), str) and entry['name'].strip(),
                    key + ' 名称不能为空')
            objects_valid(entry.get('objects'), entry['name'])
            if key == 'recipes':
                require(any(o['type'] == 'slot' and o.get('role') == 'output' and o.get('item') in ids
                            for o in entry['objects']), '配方“' + entry['name'] + '”缺少有效输出 Item')
                if any(o['type'] == 'item' for o in entry['objects']):
                    warnings.append('配方“' + entry['name'] + '”存在未归位 Item')
    for file in project['files']:
        require(isinstance(file, dict) and isinstance(file.get('path'), str)
                and isinstance(file.get('src'), str) and file['src'].startswith('data:image/'), '文件素材必须内嵌图片')
    camera = project.get('camera')
    require(isinstance(camera, dict) and all(number(camera.get(k)) for k in ('x', 'y', 'z'))
            and .25 <= camera['z'] <= 3, 'camera 无效')
    require(isinstance(project.get('recentItems', []), list)
            and all(i in ids for i in project.get('recentItems', [])), '最近 Item 引用无效')
    require(isinstance(project.get('hiddenExamples', []), list)
            and all(isinstance(i, str) for i in project.get('hiddenExamples', [])), 'hiddenExamples 无效')
    return warnings


class Conflict(Exception):
    pass


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()
        self.state = {'revision': 0, 'project': None}
        if self.path.exists():
            state = json.loads(self.path.read_text())
            validate(state['project'])
            self.state = state

    def read(self):
        with self.lock:
            return copy.deepcopy(self.state)

    def change(self, revision, operation):
        with self.lock:
            if type(revision) is not int or revision != self.state['revision']:
                raise Conflict('工程已被其他客户端修改，请重新读取 revision 后再提交')
            project = operation(copy.deepcopy(self.state['project']))
            warnings = validate(project)
            state = {'revision': revision + 1, 'project': project}
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix('.tmp')
            with temporary.open('w') as stream:
                json.dump(state, stream, ensure_ascii=False)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            self.state = state
            return {'revision': state['revision'], 'warnings': warnings}


def schema():
    return {
        'name': 'Recipe Studio Local API', 'version': 1,
        'workflow': ['GET /api/summary', 'GET /api/project or GET /api/<resource>',
                     'Send JSON write request with the last revision; on 409 reread and reconcile'],
        'endpoints': {
            'GET /api/project': 'Returns {revision, project}; project is null until the browser first syncs',
            'PUT /api/project': '{revision, project}: replace complete project atomically',
            'GET /api/summary': 'Compact Item names, recipe/template indexes, workspace counts; no image bytes',
            'GET /api/<resource>': 'Returns {revision, values}',
            'GET /api/<resource>/<key>': 'Returns {revision, value}',
            'POST /api/<resource>': '{revision, value}; Item creation optionally accepts category: [names]',
            'PATCH /api/<resource>/<key>': '{revision, changes}: shallow merge one entry',
            'DELETE /api/<resource>/<key>': '{revision}: delete one entry; invalid references are rejected',
        },
        'resources': RESOURCES,
        'keys': 'items and objects use string ID; categories, recipes, templates and files use zero-based index',
        'project': {'version': 3, 'items': '[Item]', 'itemCategories': '[{path:[string],ids:[Item ID]}]',
                    'objects': '[Object]', 'recipes': '[{name,objects:[Object]}]',
                    'templates': '[{name,objects:[Object]}]', 'files': '[{path,src:data URL}]',
                    'camera': '{x,y,z:0.25..3}', 'recentItems': '[Item ID]', 'hiddenExamples': '[example Item ID]'},
        'Item': {'id': 'unique string', 'name': 'string', 'type': 'ore|ingot|plate|part',
                 'color': '#RRGGBB', 'icon': 'optional data:image/... URL'},
        'Object': {'id': 'unique within collection', 'type': 'image|slot|item', 'x': 'number', 'y': 'number',
                   'w': 'positive number', 'h': 'positive number', 'item': 'Item ID or null',
                   'qty': 'integer 1..999 for slot/item', 'role': 'input|output for slot',
                   'src': 'image data URL, or assets/crafting.svg / assets/processor.svg', 'group': 'optional string', 'coupled': 'optional bool'},
        'rules': ['Each saved recipe needs an output slot with a valid Item',
                  'Loose Items in recipes generate warnings, not inputs or outputs',
                  'All referenced Item IDs must exist', 'Browser detects concurrent changes instead of overwriting'],
    }


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *_):
        pass

    def reply(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def trusted(self):
        host = self.headers.get('Host', '')
        allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        origin = self.headers.get('Origin')
        return host in allowed and (not origin or origin in {'http://' + h for h in allowed}) \
            and self.headers.get('Sec-Fetch-Site') != 'cross-site'

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith('/api/'):
            return self.api('GET')
        if path not in ('/', '/index.html', '/assets/crafting.svg', '/assets/processor.svg'):
            return self.reply(404, {'error': 'Not found'})
        self.send_static()

    def send_static(self):
        super().do_GET()

    def do_PUT(self):
        self.api('PUT')

    def do_PATCH(self):
        self.api('PATCH')

    def do_POST(self):
        self.api('POST')

    def do_DELETE(self):
        self.api('DELETE')

    def do_HEAD(self):
        self.reply(405, {'error': 'Use GET'})

    def api(self, method):
        if not self.trusted():
            return self.reply(403, {'error': 'Only local same-origin requests are allowed'})
        parts = [unquote(p) for p in urlsplit(self.path).path.split('/') if p]
        if len(parts) < 2 or parts[0] != 'api':
            return self.reply(404, {'error': 'Not found'})
        store = self.server.store
        try:
            if method == 'GET' and parts[1] == 'schema':
                return self.reply(200, schema())
            state = store.read()
            if method == 'GET' and parts[1] == 'project':
                return self.reply(200, state)
            if method == 'GET' and parts[1] == 'summary':
                p = state['project']
                return self.reply(200, {'revision': state['revision'], 'initialized': p is not None,
                    'counts': {r: len(p[k]) if p else 0 for r, k in RESOURCES.items()},
                    'items': [{'id': i['id'], 'name': i['name']} for i in p['items']] if p else [],
                    'recipes': [{'index': n, 'name': r['name']} for n, r in enumerate(p['recipes'])] if p else [],
                    'templates': [{'index': n, 'name': r['name']} for n, r in enumerate(p['templates'])] if p else []})
            resource = RESOURCES.get(parts[1])
            if method == 'GET':
                if resource is None or not state['project']:
                    return self.reply(404, {'error': 'Resource not found or project not initialized'})
                values = state['project'][resource]
                if len(parts) == 2:
                    return self.reply(200, {'revision': state['revision'], 'values': values})
                index = self.entry_index(values, resource, parts[2])
                return self.reply(200, {'revision': state['revision'], 'value': values[index]})
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                return self.reply(415, {'error': 'Content-Type must be application/json'})
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= 50 * 1024 * 1024:
                return self.reply(413, {'error': 'JSON body must be 1 byte to 50 MB'})
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError('JSON body 必须是对象')

            def operation(p):
                if method == 'PUT' and parts[1] == 'project' and len(parts) == 2:
                    return body.get('project')
                if resource is None or p is None:
                    raise LookupError('Resource not found or project not initialized')
                values = p[resource]
                if method == 'POST' and len(parts) == 2:
                    value = body.get('value')
                    values.append(value)
                    if resource == 'items' and isinstance(value, dict):
                        path = body.get('category', ['未分类'])
                        category = next((c for c in p['itemCategories'] if c['path'] == path), None)
                        if category is None:
                            category = {'path': path, 'ids': []}
                            p['itemCategories'].append(category)
                        category['ids'].append(value.get('id'))
                elif method in ('PATCH', 'DELETE') and len(parts) == 3:
                    index = self.entry_index(values, resource, parts[2])
                    if method == 'PATCH':
                        changes = body.get('changes')
                        if not isinstance(changes, dict):
                            raise ValueError('changes 必须是对象')
                        values[index].update(changes)
                    else:
                        old = values.pop(index)
                        if resource == 'items':
                            for category in p['itemCategories']:
                                category['ids'] = [i for i in category['ids'] if i != old['id']]
                            p['recentItems'] = [i for i in p.get('recentItems', []) if i != old['id']]
                else:
                    raise LookupError('Endpoint not found')
                return p
            result = store.change(body.get('revision'), operation)
            self.reply(200, result)
        except Conflict as exc:
            self.reply(409, {'error': str(exc), 'revision': store.read()['revision']})
        except (LookupError, IndexError) as exc:
            self.reply(404, {'error': str(exc)})
        except (ValueError, TypeError, AttributeError) as exc:
            self.reply(422, {'error': str(exc)})

    @staticmethod
    def entry_index(values, resource, key):
        if resource in ('items', 'objects'):
            for index, value in enumerate(values):
                if value.get('id') == key:
                    return index
            raise LookupError('ID not found')
        try:
            index = int(key)
            if index < 0 or index >= len(values):
                raise LookupError('Index not found')
            return index
        except ValueError as exc:
            raise LookupError('Index must be a non-negative integer') from exc


def make_server(port=8766, state_path=None):
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)
    try:
        server.store = Store(state_path or ROOT / '.local' / 'project.json')
    except Exception:
        server.server_close()
        raise
    return server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--state', type=Path, help='Optional independent project state file')
    args = parser.parse_args()
    server = make_server(args.port, args.state)
    url = f'http://127.0.0.1:{server.server_port}/'
    if args.open:
        threading.Timer(.3, lambda: webbrowser.open(url)).start()
    print('配方工作室：' + url, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
