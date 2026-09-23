import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3001;

// Настройка заголовков безопасности (CSP)
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"
  );
  next();
});

// Объект категорий для поиска
const Q = {
  'Салоны красоты': ['салон красоты', 'парикмахерская', 'косметология'],
  'Кафе и рестораны': ['кафе', 'ресторан', 'кофейня'],
  'Автосервисы': ['автосервис', 'СТО', 'шиномонтаж']
};

// Тестовые демо-данные на случай, если реального ключа 2ГИС нет в .env
const demo = [
  { id: '1', name: 'Beauty Studio Almaty', category: 'Салоны красоты', address: 'ул. Абая, 44', website: '', phone: '+77071112233', rating: 4.8, reviews: 120, social: '' },
  { id: '2', name: 'Coffee House', category: 'Кафе и рестораны', address: 'ул. Достык, 10', website: 'https://coffee.kz', phone: '+77074445566', rating: 4.5, reviews: 85, social: '' }
];

// Функция нормализации ссылок
function norm(u) {
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : 'https://' + u;
}

// Функция маппинга данных из 2ГИС
function map(x, cat) {
  const contacts = x.contact_groups?.flatMap(g => g.contacts || []) || [];
  const phone = contacts.find(c => c.type === 'phone')?.value || '';
  
  const websiteContact = contacts.find(c => c.type === 'website');
  const rawWebsite = websiteContact?.url || websiteContact?.value || websiteContact?.text || x.website || '';
  const website = norm(rawWebsite);

  return {
    id: x.id,
    name: x.name_ex?.primary || x.name || 'Без названия',
    category: x.rubrics?.[0]?.name || cat,
    address: x.full_address_name || x.address_name || '',
    website: website,
    phone: phone,
    rating: x.reviews?.general_rating ?? x.rating ?? 0,
    reviews: x.reviews?.general_review_count ?? x.reviews_count ?? 0,
    social: ''
  };
}

// Эндпоинт поиска лидов
app.get('/api/leads/search', async (req, res) => {
  const city = req.query.city || 'Алматы';
  const cat = req.query.category || 'Все категории';
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  if (!process.env.DGIS_API_KEY) {
    console.log('[Бэкенд] DGIS_API_KEY не найден. Отдаю демо-данные.');
    return res.json({ demo: true, items: demo.slice(0, limit) });
  }

  try {
    const qs = cat === 'Все категории' ? Object.values(Q).flat() : (Q[cat] || [cat]);
    const m = new Map();

    for (const q of qs) {
      const u = new URL('https://2gis.com');
      u.searchParams.set('q', `${q} ${city}`);
      u.searchParams.set('type', 'branch');
      u.searchParams.set('key', process.env.DGIS_API_KEY);
      u.searchParams.set('page_size', String(limit));
      u.searchParams.set('fields', 'items.contact_groups,items.reviews,items.rubrics');

      const r = await fetch(u);
      if (!r.ok) {
        console.error(`[2ГИС Ошибка] Статус: ${r.status}`);
        continue;
      }

      const d = await r.json();
      for (const x of d.result?.items || []) {
        if (!m.has(x.id)) m.set(x.id, map(x, cat));
        if (m.size >= limit) break;
      }
      if (m.size >= limit) break;
    }

    res.json({ demo: false, items: [...m.values()].slice(0, limit) });
  } catch (e) {
    console.error('[Критическая ошибка бэкенда]:', e);
    res.status(500).json({ error: e.message });
  }
});

// Проверка доступности сайтов (Опечатка со статусами полностью исправлена)
async function check(u) {
  if (!u) return { reachable: false, status: null, reason: 'no-site' };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 7000);
  try {
    let r = await fetch(u, { method: 'HEAD', redirect: 'follow', signal: ac.signal, headers: { 'user-agent': 'ClientFinder/1.0' } });
    
    // Исправлено: добавили массив статусов для проверки повторного GET запроса
    if ([403, 405].includes(r.status)) {
      r = await fetch(u, { method: 'GET', redirect: 'follow', signal: ac.signal, headers: { 'user-agent': 'ClientFinder/1.0' } });
    }
    
    clearTimeout(t);
    return { reachable: r.ok, status: r.status, finalUrl: r.url };
  } catch (e) {
    clearTimeout(t);
    return { reachable: false, status: null, reason: e.name === 'AbortError' ? 'timeout' : 'unreachable' };
  }
}

app.post('/api/leads/check-sites', async (req, res) => {
  const a = (req.body.items || []).slice(0, 100);
  const out = [];
  for (const x of a) {
    out.push({ ...x, websiteCheck: await check(x.website) });
  }
  res.json({ items: out });
});

// Шаблоны сообщений
function fallback(x) {
  if (!x.website) return `Здравствуйте! Я занимаюсь Web Design и Frontend-разработкой. Обратил внимание на ${x.name}. Увидел, что у вашей компании нет сайта. Могу разработать современный адаптивный сайт.`;
  return `Здравствуйте! Я занимаюсь Web Design и Frontend-разработкой. Посмотрел ${x.name} и хотел предложить улучшить веб-присутствие.`;
}

// Генерация сообщений через OpenAI
app.post('/api/messages/generate', async (req, res) => {
  const x = req.body.lead || {};
  if (!process.env.OPENAI_API_KEY) {
    return res.json({ message: fallback(x), mode: 'template' });
  }

  try {
    const c = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await c.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `Напиши короткое персональное первое B2B-сообщение на русском для веб-дизайнера. Укажи компанию ${x.name}. Не дави. Данные: ${JSON.stringify(x)}`
        }
      ]
    });
    res.json({ message: r.choices.message.content.trim(), mode: 'ai' });
  } catch (e) {
    console.error("OpenAI Error:", e);
    res.json({ message: fallback(x), mode: 'fallback' });
  }
});

app.listen(PORT, () => console.log('Сервер Client Finder запущен на порту ' + PORT));
