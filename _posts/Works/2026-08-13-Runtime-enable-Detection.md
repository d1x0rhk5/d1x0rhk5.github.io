---
layout: post
title: Runtime.enable Detection
comments: false
categories: Works
---

## 1. Runtime.enable

CDP client가 보내는 `Runtime.enable` 명령은 아래와 같다.

```javascript
await cdp.send("Runtime.enable");
```

`Runtime.enable`은 CDP의 Runtime domain을 활성화해 `executionContextCreated` 같은 Runtime event들의 보고를 시작한다. 또한 Runtime domain이 활성화되면 `Runtime.consoleAPICalled`를 통해 console 호출이 Inspector 쪽으로 전달된다.

이 과정에서 Inspector는 전달된 JavaScript 객체의 속성을 조회하거나 직렬화한다. JavaScript 객체는 getter나 Proxy를 통해 속성 접근 자체에 사용자 코드를 삽입할 수 있으므로, Inspector의 조회가 페이지에서 관측 가능한 side effect를 발생시킬 수 있다.

이러한 특성을 이용해 `Runtime.enable`을 탐지하는 여러 기법이 있었으며, V8 역시 이를 막기 위해 Inspector 코드를 수정했다.

또 하나 중요한 특징은 `Runtime.enable`이 호출 이후의 console message만 처리하는 것이 아니다. 저장된 과거 console message도 활성화 시점에 다시 Inspector로 전달된다.

따라서 console message가 Inspector로 전달되는 경로는 크게 두 가지로 나눌 수 있다.

### Backlog 경로

`Runtime.enable`이 호출되면 execution context를 먼저 보고한 뒤, `V8ConsoleMessageStorage`에 저장된 과거 message를 순회한다. 각 message는 `reportMessage(message, false)`로 전달된다.

`false`는 일반 객체의 속성을 미리 수집해 preview를 생성하지 않는다는 의미다. 하지만 값이 Native Error라면 객체를 문자열 설명으로 만들기 위해 `descriptionForError()`가 실행되면서 속성 값에 접근하게 된다.

따라서 Error description을 이용하는 탐지는 `Runtime.enable` 호출 시 backlog replay만으로도 탐지될 수 있다.

### Live message 경로

Runtime domain이 활성화된 뒤 페이지가 `console`을 호출하면 message는 `V8RuntimeAgentImpl::messageAdded()`로 들어간다. 이 함수는 `reportMessage(message, true)`를 호출한다.

이 때문에 객체의 preview 과정에서 property iterator가 key와 descriptor를 수집하므로 다른 진입 경로가 존재한다.

## 2. Classic `Error.stack` getter

[How New Headless Chrome & the CDP Signal Are Impacting Bot Detection](https://datadome.co/threat-research/how-new-headless-chrome-the-cdp-signal-are-impacting-bot-detection/)

### 탐지 코드

```javascript
let detected = false;
const error = new Error("runtime probe");

Object.defineProperty(error, "stack", {
  configurable: true,
  get() {
    detected = true;
    return "";
  },
});

console.debug(error);
```

### Root Cause

`Runtime.enable`이 켜지면 이전에 쌓여 있던 console message나 새로 발생한 console 호출을 Inspector가 처리한다. 이때 console 인수에 `Error` 객체가 있으면 V8은 이를 표시하기 위해 `stack` 값을 읽는다.

`stack` 접근이 일반적인 JavaScript 속성들의 접근처럼 동작하기 때문에 페이지가 `Error.stack`에 직접 getter를 정의해두었다면, Inspector가 `stack`을 읽는 순간 그 getter가 실행된다.

### Patch

2025년 5월 9일에 Error 전용 `getErrorProperty()`를 추가했다.

[Diff - e08e97347454255a337dcea361808fb25ca09077^! - v8/v8 - Git at Google](https://chromium.googlesource.com/v8/v8/+/e08e97347454255a337dcea361808fb25ca09077%5E%21/)

## 3. Bound builtin getter

### 탐지 코드

```javascript
let detected = false;
const error = new Error("runtime probe");

Object.defineProperty(error, "stack", {
  configurable: true,
  get: Function.prototype.call.bind(() => {
    detected = true;
    return "Error: runtime probe";
  }),
});

console.debug(error);
```

### Root Cause

V8 14.6의 `V8RuntimeAgentImpl::enable()`은 Runtime domain을 활성화한 뒤 해당 context group에 기존에 저장되어 있던 console message들을 순회하면서 CDP client에 전달한다.

[V8 14.6 source의 V8RuntimeAgentImpl::enable()](https://chromium.googlesource.com/v8/v8/+/refs/branch-heads/14.6/src/inspector/v8-runtime-agent-impl.cc#1101)

2025년에 추가된 패치는 Error property의 getter가 V8 내부 builtin인지 판별하기 위해 bound function의 가장 안쪽 target까지 내려간 뒤 해당 함수의 `ScriptId`를 검사했다.

이 때문에 탐지 코드처럼 겉으로 보이는 bound target은 native `Function.prototype.call`이지만, 실제 호출 시에는 페이지가 정의한 다른 함수가 실행되도록 우회할 수 있었다.

아래 형태도 마찬가지다.

```javascript
get: Reflect.apply.bind(
  null,
  () => {
    hit += 1;
    return "Error: runtimeenable";
  },
  undefined,
  [],
)
```

### 2026년 6월 22일 수정

후속 패치에서 `.bind()`로 감싼 getter는 아예 안전한 builtin으로 인정하지 않게 되어 해당 기법은 차단되었다.

## 4. Inherited `Error.stack`

2025년 패치는 Error 자신의 own descriptor만 검사했다. Own `stack`이 없을 때는 일반 `Get()`처럼 검사하는 문제가 있었다.

### 탐지 코드

```javascript
let detected = false;
const error = new Error("runtime probe");

delete error.stack;

const probePrototype = Object.create(Object.getPrototypeOf(error));
Object.defineProperty(probePrototype, "stack", {
  configurable: true,
  get() {
    detected = true;
    return "Error: runtime probe";
  },
});

Object.setPrototypeOf(error, probePrototype);
console.debug(error);
```

`stack`이 Error 객체 자신에게 없고 prototype에 존재하는 경우다.

### Root Cause

Inspector가 Error의 `stack`을 처리할 때 사용하는 `getErrorProperty()`는 먼저 객체 자신의 property descriptor를 확인한다. own descriptor가 없으면 현재 구현은 다음과 같이 일반 `Get()`으로 fallback한다.

```c++
if (!descriptor->IsObject()) return object->Get(context, name);
```

JavaScript의 일반 `Get` semantics는 property가 현재 객체에 없으면 prototype chain을 따라가며 값을 찾는다.

위 탐지 코드에서는 inherited `stack` getter를 찾고 페이지 JavaScript를 실행한다. `ScriptId` 검사는 위 fallback 전에 끝나므로 inherited getter에는 적용되지 않는다.

### 현재 상태

글 작성 시점인 2026년 8월 13일의 V8 main source에도 이 fallback이 남아 있어 backlog와 live message 양쪽 모두에서 탐지할 수 있다.

[V8 main의 `getErrorProperty()`](https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/inspector/value-mirror.cc#274)

> 공개된 탐지 기법과 V8의 패치에 대해 알아보면서 추가적인 `Runtime.enable` 가능 경로가 있는지 직접 찾아보았다. 그 결과 `Runtime.enable` 단일 명령을 탐지할 수 있는 두 가지 추가 경로를 찾을 수 있었다.

## 5. Proxy

현재의 `isBuiltinGetter()`에는 검사 의미와 실제 호출 의미 사이의 차이가 남아 있었다.

### 탐지 코드

```javascript
let detected = false;
const error = new Error("runtime probe");

const stackGetter = new Proxy(Math.abs, {
  apply() {
    detected = true;
    return "Error: runtime probe\n    at probe.js:1:1";
  },
});

Object.defineProperty(error, "stack", {
  configurable: true,
  get: stackGetter,
});

console.debug(error);
```

Inspector가 Error의 `stack`을 읽으면 Proxy의 `apply`가 실행되어 `detected`가 `true`가 된다. `Math.abs`는 Proxy를 callable로 만들기 위한 target이고, 관측 지점은 페이지가 정의한 `apply`다.

### Root Cause

현재 `getErrorProperty()`는 own accessor의 getter가 `Function`으로 보이면 `isBuiltinGetter()`로 builtin인지 검사한다. V8 API의 `IsFunction()` 검사는 callable 여부를 기준으로 하므로 callable target을 감싼 Proxy도 해당 검사를 통과한다.

```c++
bool isBuiltinGetter(v8::Local<v8::Function> function) {
  if (function->GetBoundFunction()->IsFunction()) return false;
  return function->ScriptId() == v8::UnboundScript::kNoScriptId;
}
```

그러나 `Function::ScriptId()`는 실제 내부 representation이 `JSFunction`이 아니면 곧바로 `kNoScriptId`를 반환한다.

```c++
int Function::ScriptId() const {
  auto self = *Utils::OpenDirectHandle(this);
  if (!IsJSFunction(self)) return v8::UnboundScript::kNoScriptId;
  auto func = i::Cast<i::JSFunction>(self);
  auto script = func->shared()->script();
  if (!IsScript(script)) return v8::UnboundScript::kNoScriptId;
  return i::Cast<i::Script>(script)->id();
}
```

Callable Proxy는 호출할 수 있어 `IsFunction()`을 통과하지만 `JSFunction`은 아니므로 `ScriptId()`에서 `kNoScriptId`를 받는다.

Bound function도 아니기 때문에 첫 번째 if문에도 걸리지 않는다. Inspector는 페이지가 제어하는 Proxy를 builtin getter로 잘못 분류하고 `object->Get(context, "stack")`을 허용해 `Runtime.enable` 탐지가 가능하다.

## 6. `RegExp.prototype.flags` getter

### 탐지 코드

페이지에서 V8 builtin인 `RegExp.prototype.flags` getter를 실제 Error의 `stack` accessor로 정한다. 그 builtin이 내부에서 읽을 global은 페이지의 getter로 만든다.

```javascript
let detected = false;
const error = new Error("runtime probe");

Object.defineProperty(error, "global", {
  configurable: true,
  get() {
    detected = true;
    return false;
  },
});

Object.defineProperty(error, "stack", {
  configurable: true,
  get: Object.getOwnPropertyDescriptor(
    RegExp.prototype,
    "flags",
  ).get,
});

console.debug(error);
```

`Runtime.enable`을 보내면 Inspector가 `stack`을 읽을 때 native flags getter가 실행되고 내부의 global property access가 페이지 getter를 호출하면서 탐지되는 구조다.

### Root Cause

`getErrorProperty()`가 직접 확인하는 `stack` getter는 실제 V8 builtin이다. 이 검사는 호출되는 함수의 출처만 확인하고, 그 함수가 실행 중에 수행하는 추가 property access까지는 검사하지 않는다.

```c++
transitioning javascript builtin RegExpPrototypeFlagsGetter(
    js-implicit context: NativeContext, receiver: JSAny)(): String {
  ThrowIfNotJSReceiver(
      receiver, MessageTemplate::kRegExpNonObject, 'RegExp.prototype.flags');

  const fastRegexp = Cast<FastJSRegExp>(receiver)
      otherwise return SlowFlagsGetter(receiver);
  return FastFlagsGetter(fastRegexp);
}
```

`RegExpPrototypeFlagsGetter` 함수는 receiver가 RegExp인지 강제하지 않는다. 위 탐지 코드에서 receiver는 Error이기 때문에 `JSReceiver` 조건을 만족하고 `FastJSRegExp` cast로 넘어간다. 여기서 실패한 뒤 도달하는 `SlowFlagsGetter`에서는 flag 값을 internal slot에서 읽지 않고 receiver의 이름 붙은 속성을 일반 `GetProperty`로 확인한다.

```c++
#define CASE_FOR_FLAG(NAME, FLAG)                                          \
  do {                                                                     \
    Label next(this);                                                      \
    const TNode<Object> flag = GetProperty(                                \
        context, regexp, isolate->factory()->InternalizeUtf8String(NAME)); \
    Label if_isflagset(this);                                              \
    BranchIfToBooleanIsTrue(flag, &if_isflagset, &next);                   \
    BIND(&if_isflagset);                                                   \
    var_length = Uint32Add(var_length.value(), Uint32Constant(1));         \
    var_flags = Signed(WordOr(var_flags.value(), IntPtrConstant(FLAG)));   \
    Goto(&next);                                                           \
    BIND(&next);                                                           \
  } while (false)

CASE_FOR_FLAG("hasIndices", JSRegExp::kHasIndices);
CASE_FOR_FLAG("global", JSRegExp::kGlobal);
CASE_FOR_FLAG("ignoreCase", JSRegExp::kIgnoreCase);
CASE_FOR_FLAG("multiline", JSRegExp::kMultiline);
CASE_FOR_FLAG("dotAll", JSRegExp::kDotAll);
CASE_FOR_FLAG("unicode", JSRegExp::kUnicode);
CASE_FOR_FLAG("sticky", JSRegExp::kSticky);
CASE_FOR_FLAG("unicodeSets", JSRegExp::kUnicodeSets);
```

두 번째로 조회하는 값인 `global`은 페이지에서 getter를 만들어두었기 때문에 해당 부분에서 사용자가 설정한 JavaScript가 실행되면서 탐지가 가능하다.
