<script setup>
import {computed,ref} from 'vue';
const cats=['Все категории','Кофейни и рестораны','Салоны красоты и барбершопы','Магазины одежды','Магазины обуви','Фитнес и спорт','Спортивные секции','Образовательные центры','Языковые школы','Детские центры','Стоматологии','Медицинские центры','Автосервисы','Клининговые компании','Фотостудии','Ювелирные магазины','Риелторские агентства','Турагентства','Ветеринарные клиники','Зоомагазины','Ремонт техники','Творческие студии','Другие услуги'];

// limit установлен в 10, добавлена переменная page для пагинации
const city=ref('Алматы'),category=ref('Все категории'),minRating=ref(4),limit=ref(10),page=ref(1),leads=ref([]),loading=ref(false),checking=ref(false),generating=ref(false),error=ref(''),info=ref(''),selected=ref(null);
const copyStatus=ref('Копировать'); // Состояние текста кнопки копирования

const shown=computed(()=>leads.value.filter(x=>Number(x.rating||0)>=Number(minRating.value)));

// Метод теперь принимает аргумент append (true, если подгружаем следующую страницу)
async function search(append = false){
  loading.value = true;
  error.value = '';
  
  // Если это новый поиск, сбрасываем страницу на первую и очищаем старый список
  if (!append) {
    page.value = 1;
    leads.value = [];
  }

  try {
    let p = new URLSearchParams({
      city: city.value,
      category: category.value,
      limit: limit.value,
      page: page.value // Отправляем номер текущей страницы на бэкенд
    });
    let r = await fetch('/api/leads/search?' + p);
    let d = await r.json();
    if (!r.ok) throw Error(d.error);
    
    const incomingItems = d.items || [];
    
    if (append) {
      // Объединяем старых и новых лидов, убирая возможные дубликаты по id
      const existingIds = new Set(leads.value.map(item => item.id));
      const uniqueNewItems = incomingItems.filter(item => !existingIds.has(item.id));
      leads.value = [...leads.value, ...uniqueNewItems];
    } else {
      leads.value = incomingItems;
    }

    info.value = d.demo ? 'Демо-режим: добавь DGIS_API_KEY в .env для реального поиска.' : `Отображено лидов: ${leads.value.length}`;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

// Функция для подгрузки следующей пачки лидов
async function loadMore(){
  page.value += 1;
  await search(true);
}

// НАДЕЖНАЯ ФУНКЦИЯ КОПИРОВАНИЯ С ФОЛБЕКОМ
function handleCopy(text) {
  if (!text) return;
  copyStatus.value = 'Копирую...';

  // Современный способ через Clipboard API
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text)
      .then(() => {
        triggerCopySuccess();
      })
      .catch(() => {
        fallbackCopyText(text);
      });
  } else {
    // Старый надежный способ для незащищенных соединений (http)
    fallbackCopyText(text);
  }
}

function fallbackCopyText(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed"; // Избегаем прокрутки страницы
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    triggerCopySuccess();
  } catch (err) {
    console.error('Не удалось скопировать текст: ', err);
    copyStatus.value = 'Ошибка';
  }
  document.body.removeChild(textArea);
}

function triggerCopySuccess() {
  copyStatus.value = 'Скопировано! ✓';
  setTimeout(() => {
    copyStatus.value = 'Копировать';
  }, 2000);
}

async function checkSites(){checking.value=true;try{let r=await fetch('/api/leads/check-sites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:leads.value})});let d=await r.json();if(!r.ok)throw Error(d.error);leads.value=d.items}catch(e){error.value=e.message}finally{checking.value=false}}
async function message(x){generating.value=true;copyStatus.value='Копировать';try{let r=await fetch('/api/messages/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lead:x})});let d=await r.json();if(!r.ok)throw Error(d.error);x.message=d.message;selected.value=x}catch(e){error.value=e.message}finally{generating.value=false}}

function score(x){let s=35;if(x.phone)s+=10;if(x.social)s+=10;if((x.rating||0)>=4.5)s+=10;if((x.reviews||0)>=20)s+=10;return Math.min(100,s)}
function status(x){return 'Нет сайта'}

function csv(){let h=['Бизнес','Категория','Сайт','Телефон','Адрес','Рейтинг','Отзывы','Приоритет','Статус','Сообщение'];let rows=shown.value.map(x=>[x.name,x.category,x.website||'',x.phone||'',x.address||'',x.rating||'',x.reviews||'',score(x),status(x),x.message||'']);let s=[h,...rows].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\n');let a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+s],{type:'text/csv;charset=utf-8'}));a.download='client-leads.csv';a.click()}
</script>

<template><main><header><div><small>WEB DESIGN / FRONTEND</small><h1>Client Finder</h1><p>2ГИС → поиск → проверка сайтов → персональные сообщения</p></div><b>Алматы · KZ</b></header><section class="panel controls"><label>Город<input v-model="city"></label><label>Категория<select v-model="category"><option v-for="c in cats">{{c}}</option></select></label><label>Мин. рейтинг<input type="number" min="0" max="5" step=".1" v-model="minRating"></label><label>Количество<input type="number" min="1" max="100" v-model="limit"></label><button class="primary" @click="search(false)" :disabled="loading">{{loading?'Ищу...':'Найти лидов'}}</button></section><div v-if="info" class="info">{{info}}</div><div v-if="error" class="error">{{error}}</div><section v-if="leads.length" class="actions"><button @click="checkSites" :disabled="checking">{{checking?'Проверяю...':'Автоматически проверить сайты'}}</button><button @click="csv">Экспорт CSV</button><span>{{shown.length}} лидов</span></section><section class="layout"><div class="panel table"><table><thead><tr><th>Бизнес</th><th>Категория</th><th>Сайт</th><th>Рейтинг</th><th>Приоритет</th><th>Статус</th><th></th></tr></thead><tbody><tr v-for="x in shown" :key="x.id"><td><strong>{{x.name}}</strong><small>{{x.address}}</small></td><td>{{x.category}}</td><td><a v-if="x.website" :href="x.website" target="_blank">{{x.website}}</a><span v-else>—</span></td><td>{{x.rating||'—'}} <small v-if="x.reviews">({{x.reviews}})</small></td><td><em>{{score(x)}}</em></td><td>{{status(x)}}</td><td><button class="small" @click="message(x)" :disabled="generating">Сообщение</button></td></tr></tbody></table><!-- Кнопка пагинации отображается только тогда, когда в таблице уже есть данные -->
<div v-if="leads.length" style="text-align: center; padding: 20px 0;"><button class="primary" @click="loadMore" :disabled="loading">{{loading ? 'Загрузка...' : 'Показать еще 10'}}</button></div><div v-if="!leads.length" class="empty">Выбери категорию и нажми «Найти лидов».</div></div><aside v-if="selected" class="panel detail"><button class="close" @click="selected=null">×</button><small>ПЕРСОНАЛЬНОЕ ОБРАЩЕНИЕ</small><h2>{{selected.name}}</h2><p>{{selected.category}} · {{selected.address}}</p><textarea v-model="selected.message" rows="13"></textarea><div style="display: flex; gap: 10px; margin-top: 10px;"><button class="primary" @click="handleCopy(selected.message)" style="flex: 1;">{{copyStatus}}</button><a v-if="selected.dgisUrl" :href="selected.dgisUrl" target="_blank" class="button secondary" style="flex: 1; text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center; padding: 10px; border: 1px solid #ccc; border-radius: 4px; background: #f9f9f9; color: #333; font-weight: bold; font-size: 14px;">Открыть в 2ГИС</a></div></aside></section></main></template>
