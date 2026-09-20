import type { FastifyInstance } from 'fastify';
import { ApiError } from '../../../global/error/api-error.js';
import { GameService } from '../application/game-service.js';
import { RegionService } from '../../region/application/region-service.js';

export function routes(app: FastifyInstance, game: GameService, regions: RegionService): void {
  // The local Expo preview uses the same API as the installed APK.
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin')
        .header('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS')
        .header('Access-Control-Allow-Headers', 'Content-Type');
    }
  });
  app.options('/api/v1/*', async (_request, reply) => reply.code(204).send());
  const mode = (query: any) => query?.mode === 'gps' ? 'gps' : 'virtual';
  const enrich = (region: any, query: any) => {
    const levelName = { sido: '시·도', sigungu: '시·군·구', emd: '읍·면·동' }[region.level as 'sido'|'sigungu'|'emd'];
    const parent = region.parentId ? regions.get(region.parentId).region.fullName : '대한민국';
    const children = regions.regions.filter(child => child.parentId === region.id).length;
    const description = `${region.name}은(는) ${parent}에 속한 ${levelName} 행정구역입니다.${children ? ` 바로 아래에 ${children}개의 행정구역이 있습니다.` : ''}${region.boundaryAvailable === false ? ' 이 지역의 지도 경계는 제공되지 않아 GPS 공략은 지원되지 않습니다.' : ''}`;
    return { ...region, description, capture: game.capture(mode(query), region) };
  };
  const execute = <T>(fn: () => T): T => fn();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof ApiError ? error.status : 503).send(error instanceof ApiError ? error.body : { error: { code: 'STORAGE_UNAVAILABLE', message: '서버를 사용할 수 없습니다.', retryable: true } }));
  const health = () => ({ ok: true, dataInfo: regions.info });
  app.get('/health', health); app.get('/api/v1/health', health);
  app.get('/api/v1/regions', request => regions.list(request.query as any));
  app.get('/api/v1/regions/:id', request => { const result = regions.get((request.params as any).id); return { ...result, region: enrich(result.region, request.query) }; });
  app.get('/api/v1/map/regions', request => { const q = request.query as any; const result = regions.map(q.level, +q.west, +q.south, +q.east, +q.north, q.limit === undefined ? 100 : +q.limit, q.overview === 'true'); return { ...result, features: result.features.map(feature => ({ ...feature, region: enrich(feature.region, q) })) }; });
  app.get('/api/v1/map/region-at', request => { const q = request.query as any; const result = regions.at(+q.lat, +q.lon, q.level); return { ...result, region: result.region ? enrich(result.region, q) : null }; });
  app.post('/api/v1/players', request => execute(() => game.join(request.body)));
  app.get('/api/v1/players/:id/state', request => execute(() => game.state((request.params as any).id)));
  app.post('/api/v1/players/:id/session', request => execute(() => game.session((request.params as any).id, request.body)));
  app.put('/api/v1/players/:id/input', request => execute(() => game.input((request.params as any).id, request.body)));
  app.post('/api/v1/players/:id/gps', request => execute(() => game.gps((request.params as any).id, request.body)));
  app.post('/api/v1/players/:id/heartbeat', request => execute(() => game.heartbeat((request.params as any).id, request.body)));
  app.post('/api/v1/players/:id/control', request => execute(() => game.control((request.params as any).id, request.body)));
  app.post('/api/v1/players/:id/purchases', request => execute(() => game.purchase((request.params as any).id, request.body)));
  app.put('/api/v1/players/:id/equipment', request => execute(() => game.equipment((request.params as any).id, request.body)));
  app.get('/api/v1/players/:id/history', request => execute(() => game.history((request.params as any).id, request.query)));
}
