const fixedTimestamp = Date.parse('2026-11-06T04:00:01.000Z');
const NativeDate = globalThis.Date;

globalThis.Date = new Proxy(NativeDate, {
  apply() {
    return new NativeDate(fixedTimestamp).toString();
  },
  construct(target, args, newTarget) {
    return Reflect.construct(target, args.length ? args : [fixedTimestamp], newTarget);
  },
  get(target, property, receiver) {
    if (property === 'now') return () => fixedTimestamp;
    return Reflect.get(target, property, receiver);
  },
});
