// Só para testes escritos antes da matriz de papéis (#86), que mandam o papel no JWT: com o #86 o
// servidor lê o papel do banco (papeis.mjs), não do token. Este helper assina o JWT e grava o
// mesmo papel no cache de teste para o usuário e a clínica do token — o teste continua dizendo o
// que dizia (o papel que ele escolheu), sem depender do papel do JWT no servidor.
import jwt from 'jsonwebtoken';
import { _definirPapelParaTestes } from '../../papeis.mjs';

export function assinarComPapel(payload, ...resto) {
  if (payload?.sub && payload?.role) _definirPapelParaTestes(payload.sub, payload.role, payload.tenant_id || '*');
  return jwt.sign(payload, ...resto);
}
