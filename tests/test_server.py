import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

from server import make_server


def project():
    return {'version': 3, 'items': [{'id': 'a', 'name': 'A', 'type': 'part', 'color': '#ffffff'}],
            'itemCategories': [{'path': ['材料'], 'ids': ['a']}], 'objects': [],
            'templates': [], 'recipes': [], 'files': [], 'recentItems': [], 'hiddenExamples': [],
            'camera': {'x': 0, 'y': 0, 'z': 1}}


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'project.json'
        self.httpd = make_server(0, self.path)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.temp.cleanup()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port)
        payload = None if body is None else json.dumps(body)
        base = {'Content-Type': 'application/json'}
        base.update(headers or {})
        conn.request(method, path, payload, base)
        response = conn.getresponse()
        result = json.loads(response.read())
        conn.close()
        return response.status, result

    def seed(self):
        status, data = self.request('PUT', '/api/project', {'revision': 0, 'project': project()})
        self.assertEqual(status, 200, data)
        return data

    def test_revision_conflict_does_not_overwrite_or_persist(self):
        self.seed()
        stale = project()
        stale['items'][0]['name'] = 'stale'
        status, _ = self.request('PUT', '/api/project', {'revision': 0, 'project': stale})
        self.assertEqual(status, 409)
        _, saved = self.request('GET', '/api/project')
        self.assertEqual(saved['project']['items'][0]['name'], 'A')
        self.assertEqual(json.loads(self.path.read_text())['project']['items'][0]['name'], 'A')

    def test_patch_item_preserves_other_fields(self):
        self.seed()
        status, data = self.request('PATCH', '/api/items/a', {'revision': 1, 'changes': {'name': '新名称'}})
        self.assertEqual(status, 200, data)
        _, state = self.request('GET', '/api/project')
        self.assertEqual(state['revision'], 2)
        self.assertEqual(state['project']['items'][0]['name'], '新名称')
        self.assertEqual(state['project']['items'][0]['type'], 'part')

    def test_invalid_recipe_rejected_atomically(self):
        self.seed()
        recipe = {'name': '无输出', 'objects': [{'id': 's', 'type': 'slot', 'x': 0, 'y': 0,
                    'w': 34, 'h': 34, 'item': 'a', 'qty': 1, 'role': 'input'}]}
        status, data = self.request('POST', '/api/recipes', {'revision': 1, 'value': recipe})
        self.assertEqual(status, 422, data)
        self.assertIn('输出', data['error'])
        _, state = self.request('GET', '/api/project')
        self.assertEqual(state['revision'], 1)
        self.assertEqual(state['project']['recipes'], [])

    def test_invalid_reference_and_foreign_origin_rejected(self):
        self.seed()
        bad = project()
        bad['itemCategories'][0]['ids'] = ['missing']
        self.assertEqual(self.request('PUT', '/api/project', {'revision': 1, 'project': bad})[0], 422)
        self.assertEqual(self.request('GET', '/api/project', headers={'Origin': 'https://example.com'})[0], 403)
        self.assertEqual(self.request('PUT', '/api/project', {'revision': 1, 'project': project()},
                                      {'Content-Type': 'text/plain'})[0], 415)

    def test_new_item_category_and_reference_protection(self):
        self.seed()
        value = {'id': 'b', 'name': 'B', 'type': 'plate', 'color': '#112233'}
        status, result = self.request('POST', '/api/items',
            {'revision': 1, 'value': value, 'category': ['加工材料', '压缩板']})
        self.assertEqual(status, 200, result)
        _, state = self.request('GET', '/api/project')
        self.assertEqual(state['project']['itemCategories'][-1]['ids'], ['b'])
        obj = {'id': 's', 'type': 'slot', 'x': 0, 'y': 0, 'w': 34, 'h': 34,
               'item': 'b', 'qty': 1, 'role': 'input'}
        self.assertEqual(self.request('POST', '/api/objects', {'revision': 2, 'value': obj})[0], 200)
        self.assertEqual(self.request('DELETE', '/api/items/b', {'revision': 3})[0], 422)

    def test_recipe_loose_warning_and_delete(self):
        self.seed()
        recipe = {'name': '配方', 'objects': [
            {'id': 's', 'type': 'slot', 'x': 0, 'y': 0, 'w': 34, 'h': 34,
             'item': 'a', 'qty': 1, 'role': 'output'},
            {'id': 'i', 'type': 'item', 'x': 40, 'y': 0, 'w': 32, 'h': 32,
             'item': 'a', 'qty': 2}]}
        status, result = self.request('POST', '/api/recipes', {'revision': 1, 'value': recipe})
        self.assertEqual(status, 200, result)
        self.assertTrue(result['warnings'])
        self.assertEqual(self.request('DELETE', '/api/recipes/0', {'revision': 2})[0], 200)
        _, state = self.request('GET', '/api/project')
        self.assertEqual(len(state['project']['items']), 1)
        self.assertEqual(state['project']['recipes'], [])

    def test_schema_summary_and_storage_reload(self):
        self.seed()
        self.assertEqual(self.request('GET', '/api/schema')[0], 200)
        _, summary = self.request('GET', '/api/summary')
        self.assertEqual(summary['counts']['items'], 1)
        other = make_server(0, self.path)
        try:
            self.assertEqual(other.store.read()['project']['items'][0]['id'], 'a')
        finally:
            other.server_close()
        self.assertEqual(self.request('GET', '/.local/project.json')[0], 404)
        self.assertEqual(self.request('GET', '/.git/config')[0], 404)


if __name__ == '__main__':
    unittest.main()
