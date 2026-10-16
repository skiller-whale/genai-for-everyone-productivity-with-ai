// Injected into every HTML artifact. The frame is sandboxed with an opaque
// origin, so it can't reach the app's API itself; it asks the parent page,
// which knows which scenario and artifact the frame belongs to.
(function () {
  let next = 0;
  const pending = new Map();
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.coworkReply === undefined) return;
    const waiter = pending.get(msg.coworkReply);
    if (!waiter) return;
    pending.delete(msg.coworkReply);
    msg.error ? waiter.reject(new Error(msg.error)) : waiter.resolve(msg.value);
  });
  function call(method, arg) {
    const id = ++next;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      parent.postMessage({ cowork: method, id, arg }, '*');
    });
  }
  window.cowork = {
    load: () => call('load'),
    save: (data) => call('save', data),
    send: (text) => call('send', String(text)),
  };
})();
