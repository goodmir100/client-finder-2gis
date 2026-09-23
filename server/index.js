import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3001;

const Q = {
  'Кофейни и рестораны': ['кофейня', 'ресторан'],
  'Салоны красоты и барбершопы': ['салон красоты', 'барбершоп'],
  'Магазины одежды': ['магазин одежды'],
  'Магазины обуви': ['магазин обуви'],
  'Фитнес и спорт': ['фитнес', 'спортзал'],
  'Спортивные секции': ['спортивная секция'],
  'Образовательные центры': ['образовательный центр', 'учебный центр'],
  'Языковые школы': ['языковая школа'],
  'Детские центры': ['детский центр'],
  'Стоматологии': ['стоматология'],
  'Медицинские центры': ['медицинский центр'],
  'Автосервисы': ['автосервис'],
  'Клининговые компании': ['клининг'],
  'Фотостудии': ['фотостудия'],
  'Ювелирные магазины': ['ювелирный магазин'],
  'Риелторские агентства': ['агентство недвижимости'],
  'Турагентства': ['туристическое агентство'],
  'Ветеринарные клиники': ['ветеринарная клиника'],
  'Зоомагазины': ['зоомагазин'],
  'Ремонт техники': ['ремонт телефонов', 'ремонт компьютеров'],
  'Творческие студии': ['творческая студия'],
  'Другие услуги': ['услуги']
};

const demo = [
  { id: 'd1', name: 'Demo Coffee Almaty', category: 'Кофейни и рестораны', address: 'Алматы', website: '', phone: '+7 700 000 00 01', rating: 4.7, reviews: 84 },
  { id: 'd2', name: 'Demo Beauty Studio', category: 'Салоны красоты и барбершопы', address: 'Алматы', website: '', phone: '+7 700 000 00 02', rating: 4.8, reviews: 112 },
  { id: 'd3', name: 'Demo Sport Club', category: 'Фитнес и спорт', address: 'Алматы', website: 'https://example.com', phone: '+7 700 000 00 03', rating: 4.5, reviews: 51 }
];

function norm(u) {
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : 'https://' + u;
}

function map(x, cat) {
  const c = x.contact_groups?.flatMap(g => g.contacts || []) || [];
  
  const websiteContact = c.find(z => z.type === 'website');
  const rawWebsite = websiteContact?.url || websiteContact?.value || websiteContact?.text || x.website || '';
  const website = norm(rawWebsite);

  return {
    id: x.id,
    name: x.name_ex?.primary || x.name || 'Без названия',
    category: x.rubrics?.[0]?.name || cat,
    address: x.full_address_name || x.address_name || '',
    website: website,
    phone: c.find(z => z.type === 'phone')?.value || '',
    rating: x.reviews?.general_rating ?? x.rating ?? 0,
    reviews: x.reviews?.general_review_count ?? x.reviews_count ?? 0,
    social: ''
  };
}

app.get('/api/leads/search', async (req, res) => {
  const city = req.query.city || 'Алматы';
  const cat = req.query.category || 'Все категории';
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  
  // Добавили чтение параметра текущей страницы (по умолчанию 1)
  const page = Number(req.query.page) || 1;

  // Если ключа нет — отдаем демо-данные СТРОГО БЕЗ сайтов
  if (!process.env.DGIS_API_KEY) {
    const filteredDemo = demo.filter(x => !x.website);
    return res.json({ demo: true, items: filteredDemo.slice(0, limit) });
  }

  try {
    const qs = cat === 'Все категории' ? Object.values(Q).flat() : (Q[cat] || [cat]);
    const m = new Map();

    for (const q of qs) {
      const u = new URL('https://catalog.api.2gis.com/3.0/items');
      u.searchParams.set('q', `${q} ${city}`);
      u.searchParams.set('type', 'branch');
      u.searchParams.set('key', process.env.DGIS_API_KEY);
      u.searchParams.set('page_size', String(limit));
      
      // Передаем страницу пагинации в 2ГИС
      u.searchParams.set('page', String(page));
      u.searchParams.set('fields', 'items.contact_groups,items.links,items.reviews,items.rubrics');
      
      // Параметр 'has_site=false' теперь передается в 2ГИС всегда
      u.searchParams.set('has_site', 'false');

      const r = await fetch(u);
      if (!r.ok) continue;

      const d = await r.json();
      for (const x of d.result?.items || []) {
        const itemData = map(x, cat);
        
        // Жесткая проверка: если сайт всё-таки обнаружился в контактах — полностью игнорируем лид
        if (itemData.website) continue;

        if (!m.has(itemData.id)) m.set(itemData.id, itemData);
        if (m.size >= limit) break;
      }
      if (m.size >= limit) break;
    }
    res.json({ demo: false, items: [...m.values()].slice(0, limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function check(u) {
  if (!u) return { reachable: false, status: null, reason: 'no-site' };
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 7000);
  try {
    let r = await fetch(u, { method: 'HEAD', redirect: 'follow', signal: ac.signal, headers: { 'user-agent': 'ClientFinder/1.0' } });
    if ([403, 405].includes(r.status)) r = await fetch(u, { method: 'GET', redirect: 'follow', signal: ac.signal, headers: { 'user-agent': 'ClientFinder/1.0' } });
    clearTimeout(t);
    return { reachable: r.ok, status: r.status, finalUrl: r.url };
  } catch (e) {
    clearTimeout(t);
    return { reachable: false, status: null, reason: e.name === 'AbortError' ? 'timeout' : 'unreachable' };
  }
}

app.post('/api/leads/check-sites', async (req, res) => {
  const a = (req.body.items || []).slice(0, 100), out = [];
  for (const x of a) out.push({ ...x, websiteCheck: await check(x.website) });
  res.json({ items: out });
});

function fallback(x) {
  return `Здравствуйте! Я занимаюсь Web Design и Frontend-разработкой. Обратил внимание на ${x.name}. Увидел, что у вашей компании нет отдельного сайта. Могу разработать современный адаптивный сайт с услугами, ценами, контактами и удобной мобильной версией. Если интересно, могу показать портфолио и предложить вариант под ваш бизнес.`;
}

app.post('/api/messages/generate', async (req, res) => {
  const x = req.body.lead || {};
  if (!process.env.OPENAI_API_KEY) return res.json({ message: fallback(x), mode: 'template' });
  
  try {
    const c = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const ratingValue = Number(x.rating || 0);
    const reviewsCount = Number(x.reviews || 0);

    const r = await c.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Ты — профессиональный frontend-разработчик и веб-дизайнер. Твоя задача — написать первое точечное B2B-сообщение в мессенджер для владельца бизнеса. У компании НЕТ САЙТА.
          
          Твой стек (используй это аккуратно, как знак качества): Vue.js, React, Tailwind CSS. Ты делаешь быстрые, кастомные и адаптивные сайты на чистом коде, а не на неуклюжих конструкторах.
          
          Используй имеющиеся цифры как главный коммерческий аргумент:
          1. Если рейтинг высокий (${ratingValue} >= 4.5) и отзывов много (${reviewsCount} >= 15):
             Сделай упор на статус. Напиши, что у них отличный поток клиентов и высокая оценка (${ratingValue}) в 2ГИС. Подчеркни, что такому сильному бренду нужен соответствующий технологичный сайт, чтобы собирать еще и горячий трафик из поисковиков, а не отдавать его конкурентам.
          2. Если отзывов мало (${reviewsCount} < 15):
             Сделай упор на развитие и доверие. Напиши, что запуск собственного современного веб-сайта поможет быстрее выстроить доверие с новыми клиентами, презентовать услуги лицом и обойти конкурентов по нише.
          
          Адаптация под сферу деятельности:
          Обыграй специфика категории "${x.category}" (например, для ресторанов/кофейни упомяни интерактивное меню/атмосферу, для услуг или медицины — удобный прайс, запись и демонстрацию экспертности).`
        },
        {
          role: 'user',
          content: `Напиши короткое, открытое к диалогу сообщение (60-80 слов) для компании "${x.name}". 
          Категория: ${x.category}. Город: ${x.address}. Рейтинг: ${ratingValue}, Отзывов: ${reviewsCount}.
          
          Строгие правила:
          - Язык: русский. Обращение строго на "Вы".
          - Никакого спама, агрессивных продаж и штампов ("уникальное предложение", "гарантия результата", "быстро и качественно").
          - Начни сразу с контекста их бизнеса или аккуратного комплимента их рейтингу.
          - Не предлагай созвоны. В конце мягко спроси, можно ли скинуть ссылку на твое портфолио с примерами современных адаптивных сайтов в их или смежной нише.`
        }
      ],
      temperature: 0.75
    });
    res.json({ message: r.choices[0].message.content.trim(), mode: 'ai' });
  } catch (e) {
    res.json({ message: fallback(x), mode: 'fallback' });
  }
});

app.listen(PORT, () => console.log('Client Finder запущен на http://localhost:' + PORT));
