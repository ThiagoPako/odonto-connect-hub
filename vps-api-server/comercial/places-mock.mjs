// Google Places SIMULADO para desenvolvimento e testes (GOOGLE_PLACES_MOCK=1, nunca em produção).
// Responde no mesmo formato da Places API (New) e do Geocoding, sem rede e sem chave real.
// Os dados são fictícios (telefones 0000/1111, domínios .exemplo) e incluem casos que o filtro
// tem de descartar: loja de material, veterinária, radiologia médica e clínica fechada.

const BASE = [
  { nome: 'Clínica Odontológica Sorriso Pleno', tipo: 'dental_clinic', rotulo: 'Clínica odontológica', fone: '(19) 3000-0001', site: 'https://sorrisopleno.exemplo' },
  { nome: 'Dra. Ana Exemplo — Ortodontia', tipo: 'dentist', rotulo: 'Dentista', fone: '(19) 99000-0002', site: null },
  { nome: 'OdontoVida Implantes', tipo: 'dental_clinic', rotulo: 'Clínica odontológica', fone: '(19) 3000-0003', site: 'https://odontovida.exemplo' },
  { nome: 'Radiologia Odontológica Imagem Oral', tipo: 'medical_lab', rotulo: 'Laboratório médico', fone: '(19) 3000-0004', site: 'https://imagemoral.exemplo' },
  { nome: 'Centro de Radiologia Médica Exemplo', tipo: 'medical_lab', rotulo: 'Laboratório médico', fone: '(19) 3000-0005', site: 'https://radmedica.exemplo' },
  { nome: 'Dental Shop Materiais', tipo: 'store', rotulo: 'Loja de material odontológico', fone: '(19) 3000-0006', site: 'https://dentalshop.exemplo' },
  { nome: 'Clínica Veterinária Dente de Leite', tipo: 'veterinary_care', rotulo: 'Veterinário', fone: '(19) 3000-0007', site: null },
  { nome: 'Consultório Dr. Bruno Exemplo', tipo: 'dentist', rotulo: 'Dentista', fone: '(19) 3000-0008', site: 'https://drbruno.exemplo', fechado: true },
  { nome: 'Odonto Kids Exemplo', tipo: 'dentist', rotulo: 'Dentista', fone: '(19) 3000-0009', site: 'https://odontokids.exemplo' },
  { nome: 'Sorriso Pleno Unidade 2', tipo: 'dental_clinic', rotulo: 'Clínica odontológica', fone: '(19) 3000-0001', site: 'https://sorrisopleno.exemplo' },
];

function lugar(b, i, cidade, uf) {
  return {
    id: `MOCKplace${String(i).padStart(4, '0')}${cidade.replace(/\W/g, '').slice(0, 12)}`,
    displayName: { text: b.nome, languageCode: 'pt-BR' },
    formattedAddress: `Rua Exemplo, ${100 + i} - Centro, ${cidade} - ${uf}, 13000-000, Brasil`,
    addressComponents: [
      { longText: cidade, shortText: cidade, types: ['administrative_area_level_2', 'political'] },
      { longText: uf, shortText: uf, types: ['administrative_area_level_1', 'political'] },
    ],
    nationalPhoneNumber: b.fone,
    ...(b.site ? { websiteUri: b.site } : {}),
    rating: 4 + (i % 10) / 10,
    userRatingCount: 10 + i * 7,
    types: [b.tipo, 'health', 'point_of_interest', 'establishment'],
    primaryType: b.tipo,
    primaryTypeDisplayName: { text: b.rotulo, languageCode: 'pt-BR' },
    businessStatus: b.fechado ? 'CLOSED_PERMANENTLY' : 'OPERATIONAL',
  };
}

const resposta = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo });

export function criarFetchPlacesMock() {
  return async function fetchMock(url, init = {}) {
    const u = String(url);
    if (u.includes('/geocode/')) return resposta({ status: 'OK', results: [{ geometry: { location: { lat: -22.9, lng: -47.06 } } }] });
    if (u.includes('places:searchText')) {
      const corpo = JSON.parse(init.body || '{}');
      const m = String(corpo.textQuery || '').match(/ em (.+) - ([A-Z]{2})$/);
      const cidade = m?.[1] || 'Campinas', uf = m?.[2] || 'SP';
      let lista = BASE.map((b, i) => lugar(b, i, cidade, uf));
      if (corpo.includedType) lista = lista.filter(p => p.types.includes(corpo.includedType) || p.primaryType === 'store' || p.primaryType === 'veterinary_care');
      const pagina = corpo.pageToken ? Number(corpo.pageToken) : 0;
      const fatia = lista.slice(pagina * 4, pagina * 4 + 4);
      return resposta({ places: fatia, ...(lista.length > (pagina + 1) * 4 ? { nextPageToken: String(pagina + 1) } : {}) });
    }
    const det = u.match(/\/places\/([^?]+)/);
    if (det) {
      const id = decodeURIComponent(det[1]);
      const i = Number(id.slice(9, 13));
      const cidade = id.slice(13) || 'Campinas';
      return BASE[i] ? resposta(lugar(BASE[i], i, cidade, 'SP')) : resposta({ error: { message: 'Not found' } }, 404);
    }
    return resposta({ error: { message: 'rota simulada desconhecida' } }, 404);
  };
}
