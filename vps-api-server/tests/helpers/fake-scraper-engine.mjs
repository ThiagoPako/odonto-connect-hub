// Engine FALSO do google-maps-scraper-kit, para testes e para ver a tela no ambiente local.
// Imita a API HTTP do engine 2.2.0 (engine/serve.py): POST/GET/DELETE /api/v1/jobs,
// /api/v1/jobs/{id}/download?format=json, X-API-Key opcional e recusa de Host que não seja localhost.
// Não acessa o Google: devolve linhas fictícias. Modo "bloqueio" simula a página de tráfego incomum.
//
// Uso manual: node tests/helpers/fake-scraper-engine.mjs 8091 [chave] [--bloquear]
import http from 'http';
import crypto from 'crypto';
import path from 'path';
import { pathToFileURL } from 'url';

const LINHAS = [
  { title: 'Clínica Odonto Raspada Centro', category: 'Clínica odontológica', categories: 'Clínica odontológica, Dentista', phone: '(19) 3111-0001', website: 'https://raspadacentro.exemplo', emails: '', address: 'R. Um, 1 - Centro, Campinas - SP, 13010-000', review_rating: '4.7', review_count: '88', place_id: 'ChIJraspado000001', status: '' },
  { title: 'Dr. Carlos Exemplo Dentista', category: 'Dentista', categories: 'Dentista', phone: '(19) 99111-0002', website: '', emails: 'carlos.exemplo@gmail.com', address: 'R. Dois, 2 - Cambuí, Campinas - SP, 13020-000', review_rating: '5', review_count: '12', place_id: 'ChIJraspado000002', status: '' },
  { title: 'Imagem Odonto Radiologia', category: 'Centro de radiologia', categories: 'Centro de radiologia', phone: '(19) 3111-0003', website: 'https://imagemodonto.exemplo', emails: 'contato@imagemodonto.exemplo', address: 'R. Três, 3, Campinas - SP', review_rating: '4.5', review_count: '40', place_id: 'ChIJraspado000003', status: '', instagram: 'https://instagram.com/naodeveriaguardar' },
  { title: 'Dental Depósito Raspado', category: 'Loja de artigos odontológicos', categories: 'Loja de artigos odontológicos, Dental supply store', phone: '(19) 3111-0004', website: '', emails: '', address: 'R. Quatro, 4, Campinas - SP', review_rating: '4.1', review_count: '9', place_id: 'ChIJraspado000004', status: '' },
  { title: 'Consultório Fechado Exemplo', category: 'Dentista', categories: 'Dentista', phone: '(19) 3111-0005', website: '', emails: '', address: 'R. Cinco, 5, Campinas - SP', review_rating: '4', review_count: '3', place_id: 'ChIJraspado000005', status: 'Permanently closed' },
  { title: '=HYPERLINK("http://x")', category: 'Dentista', categories: 'Dentista', phone: '(19) 3111-0006', website: '', emails: '', address: 'R. Seis, 6, Campinas - SP', review_rating: '', review_count: '', place_id: 'ChIJraspado000006', status: '' },
];

export function criarEngineFalso({ apiKey = '', bloquear = false, pollsAteTerminar = 2 } = {}) {
  const jobs = new Map();
  const recebidos = [];
  const server = http.createServer((req, res) => {
    const responder = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'X-Engine': 'gmskit-engine/2.2.0-falso' }); res.end(JSON.stringify(body)); };
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.headers.host || '')) return responder(421, { code: 421, message: 'this engine answers to localhost only' });
    if (apiKey && req.headers['x-api-key'] !== apiKey) return responder(401, { code: 401, message: 'missing or wrong X-API-Key' });
    const [caminho, query] = req.url.split('?');
    const m = caminho.match(/^\/api\/v1\/jobs\/([0-9a-f-]{36})(\/download)?$/);
    if (req.method === 'POST' && caminho === '/api/v1/jobs') {
      let corpo = '';
      req.on('data', c => { corpo += c; });
      req.on('end', () => {
        const b = JSON.parse(corpo || '{}');
        recebidos.push(b);
        if (!b.name || !Array.isArray(b.keywords) || !b.keywords.length || !b.lang || !b.max_time) return responder(422, { code: 422, message: 'missing fields' });
        const id = crypto.randomUUID();
        jobs.set(id, { ID: id, Name: b.name, Date: new Date().toISOString(), Status: 'pending', Error: '', polls: 0, Data: b });
        responder(201, { id });
      });
      return;
    }
    if (m && req.method === 'DELETE') return jobs.delete(m[1]) ? responder(200, { message: 'deleted' }) : responder(404, { code: 404, message: 'job not found' });
    if (m && req.method === 'GET') {
      const j = jobs.get(m[1]);
      if (!j) return responder(404, { code: 404, message: 'job not found' });
      if (m[2]) {
        if (j.Status !== 'ok') return responder(404, { code: 404, message: 'no results for this job (yet)' });
        if (!/format=json/.test(query || '')) return responder(400, { code: 400, message: 'only json in the fake' });
        return responder(200, LINHAS);
      }
      j.polls++;
      if (j.Status !== 'ok' && j.Status !== 'failed') {
        if (j.polls >= pollsAteTerminar) {
          if (bloquear) { j.Status = 'failed'; j.Error = "Google answered with its unusual-traffic page: this IP is rate-limited for now. Wait, or add proxies"; }
          else j.Status = 'ok';
        } else j.Status = 'working';
      }
      const places = j.Status === 'ok' ? LINHAS.length : j.polls;
      return responder(200, { ID: j.ID, Name: j.Name, Date: j.Date, Status: j.Status, Error: j.Error, Data: j.Data,
        Progress: { keywords_done: j.Status === 'ok' ? j.Data.keywords.length : 0, keywords_total: j.Data.keywords.length, places, percent: j.Status === 'ok' ? 100 : 40, stage: j.Status === 'ok' ? 'done' : 'search' } });
    }
    responder(404, { code: 404, message: 'not found' });
  });
  return {
    server, jobs, recebidos,
    ouvir: (porta = 0) => new Promise(r => server.listen(porta, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))),
    fechar: () => new Promise(r => server.close(r)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [porta = '8091', chave = ''] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const e = criarEngineFalso({ apiKey: chave, bloquear: process.argv.includes('--bloquear'), pollsAteTerminar: 3 });
  e.ouvir(Number(porta)).then(url => console.log(`engine falso em ${url}`));
}
