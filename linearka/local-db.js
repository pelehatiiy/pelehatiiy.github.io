/* Ranní lineárka — web version storage.
   Provides the small part of the Claude artifact runtime the trainer uses
   (claude.use("db")) on top of static JSON files and the browser's localStorage,
   so the same app code runs on GitHub Pages. Progress stays in this browser. */
(function () {
  "use strict";
  var KEY = "linearka:";
  var store = {
    get: function (p) { try { var v = localStorage.getItem(KEY + p); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set: function (p, v) { try { localStorage.setItem(KEY + p, JSON.stringify(v)); } catch (e) {} },
    del: function (p) { try { localStorage.removeItem(KEY + p); } catch (e) {} },
    keys: function (coll) {
      var out = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(KEY + coll + "/") === 0) {
            var rest = k.slice(KEY.length + coll.length + 1);
            if (rest.indexOf("/") === -1) out.push(rest);
          }
        }
      } catch (e) {}
      return out;
    }
  };
  var data = { questions: [], config: null };
  var ready = Promise.all([
    fetch("questions.json").then(function (r) { return r.json(); }),
    fetch("config.json").then(function (r) { return r.json(); })
  ]).then(function (res) { data.questions = res[0] || []; data.config = res[1] || null; })
    .catch(function (e) { console.warn("Ranní lineárka: data se nenačetla", e); });

  var META = { fromCache: false, hasPendingWrites: false };
  function docSnap(id, body) {
    return { id: id, exists: body != null, data: function () { return body == null ? undefined : body; }, metadata: META };
  }
  function qSnap(docs) {
    return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: META };
  }
  function readDoc(path) { return path === "config/course" ? data.config : store.get(path); }
  function readColl(coll) {
    if (coll === "questions") {
      return data.questions.map(function (q) {
        var body = {}; for (var k in q) if (k !== "id") body[k] = q[k];
        return docSnap(q.id, body);
      });
    }
    return store.keys(coll).sort().map(function (id) { return docSnap(id, store.get(coll + "/" + id)); });
  }

  var listeners = [];
  function notify(path) {
    var parts = path.split("/"), id = parts.pop(), coll = parts.join("/");
    listeners.slice().forEach(function (l) {
      if (l.kind === "doc" && l.path === path) l.cb(docSnap(id, readDoc(path)));
      if (l.kind === "coll" && l.path === coll) l.cb(qSnap(readColl(coll)));
    });
  }
  function listen(l) {
    listeners.push(l);
    ready.then(function () {
      if (listeners.indexOf(l) === -1) return;
      if (l.kind === "doc") l.cb(docSnap(l.path.split("/").pop(), readDoc(l.path)));
      else l.cb(qSnap(readColl(l.path)));
    });
    return function () { var i = listeners.indexOf(l); if (i > -1) listeners.splice(i, 1); };
  }

  function doc(path) {
    var id = path.split("/").pop();
    return {
      id: id, path: path,
      get: function () { return ready.then(function () { return docSnap(id, readDoc(path)); }); },
      set: function (body) { store.set(path, JSON.parse(JSON.stringify(body))); notify(path); return Promise.resolve(); },
      update: function (body) { var cur = store.get(path) || {}; for (var k in body) cur[k] = body[k]; store.set(path, cur); notify(path); return Promise.resolve(); },
      delete: function () { store.del(path); notify(path); return Promise.resolve(); },
      onSnapshot: function (cb) { return listen({ kind: "doc", path: path, cb: cb }); },
      collection: function (sub) { return collection(path + "/" + sub); }
    };
  }
  function collection(coll, order, lim) {
    return {
      path: coll,
      where: function () { return collection(coll, order, lim); },
      orderBy: function (f, dir) { return collection(coll, { f: f, dir: dir || "asc" }, lim); },
      limit: function (n) { return collection(coll, order, n); },
      doc: function (id) { return doc(coll + "/" + id); },
      get: function () {
        return ready.then(function () {
          var docs = readColl(coll);
          if (order) docs.sort(function (a, b) {
            var x = (a.data() || {})[order.f], y = (b.data() || {})[order.f];
            return (x < y ? -1 : x > y ? 1 : 0) * (order.dir === "desc" ? -1 : 1);
          });
          if (lim) docs = docs.slice(0, lim);
          return qSnap(docs);
        });
      },
      onSnapshot: function (cb) { return listen({ kind: "coll", path: coll, cb: cb }); }
    };
  }

  var db = { doc: doc, collection: function (c) { return collection(c); } };
  window.claude = { use: function (name) { return Promise.resolve(name === "db" ? db : null); } };
})();
