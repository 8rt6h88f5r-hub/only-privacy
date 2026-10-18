import koffi from 'koffi';
const PREFIX='org.onlyprivacy.owner.';
let api;
function mac(){
  if(process.platform!=='darwin')throw Error('Local owner unlock uses macOS Keychain on this computer');
  if(api)return api;
  const cf=koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const sec=koffi.load('/System/Library/Frameworks/Security.framework/Security');
  api={
    symbol:name=>koffi.decode(sec.symbol(name),'void *'),
    text:cf.func('void *CFStringCreateWithCString(void *allocator, const char *text, unsigned int encoding)'),
    data:cf.func('void *CFDataCreate(void *allocator, const uint8_t *bytes, long length)'),
    dictionary:cf.func('void *CFDictionaryCreateMutable(void *allocator, long capacity, void *keys, void *values)'),
    set:cf.func('void CFDictionarySetValue(void *dictionary, const void *key, const void *value)'),
    release:cf.func('void CFRelease(const void *object)'),
    length:cf.func('long CFDataGetLength(const void *data)'),
    bytes:cf.func('const uint8_t *CFDataGetBytePtr(const void *data)'),
    add:sec.func('int SecItemAdd(const void *attributes, _Out_ void **result)'),
    find:sec.func('int SecItemCopyMatching(const void *query, _Out_ void **result)'),
    remove:sec.func('int SecItemDelete(const void *query)'),
    keyCallbacks:cf.symbol('kCFTypeDictionaryKeyCallBacks'),valueCallbacks:cf.symbol('kCFTypeDictionaryValueCallBacks'),
    boolean:koffi.decode(cf.symbol('kCFBooleanTrue'),'void *')
  };return api;
}
function query(service,action){
  if(typeof service!=='string'||!new RegExp('^'+PREFIX.replaceAll('.','\\.')+'[a-f0-9]{32}$').test(service))throw Error('Not an OnlyPrivacy owner keychain slot');
  const a=mac(),refs=[],dict=a.dictionary(null,0,a.keyCallbacks,a.valueCallbacks);
  const text=s=>{const p=a.text(null,s,0x08000100);refs.push(p);return p;};
  a.set(dict,a.symbol('kSecClass'),a.symbol('kSecClassGenericPassword'));
  a.set(dict,a.symbol('kSecAttrService'),text(service));a.set(dict,a.symbol('kSecAttrAccount'),text('owner'));
  try{return action(a,dict,refs,text);}finally{a.release(dict);for(const p of refs)a.release(p);}
}
export function storeOwnerSecret(service,secret){
  return query(service,(a,dict,refs,text)=>{
    const bytes=Buffer.from(secret),data=a.data(null,bytes,bytes.length);refs.push(data);
    a.set(dict,a.symbol('kSecValueData'),data);a.set(dict,a.symbol('kSecAttrLabel'),text('OnlyPrivacy local encrypted owner wallet'));
    try{const status=a.add(dict,null);if(status!==0)throw Error('Keychain refused new wallet secret ('+status+')');}finally{bytes.fill(0);}
  });
}
export function readOwnerSecret(service){
  return query(service,(a,dict)=>{
    a.set(dict,a.symbol('kSecReturnData'),a.boolean);const result=[null],status=a.find(dict,result);
    if(status!==0)throw Error('Unlock this computer and allow access to its OnlyPrivacy Keychain item ('+status+')');
    try{const bytes=Buffer.from(koffi.decode(a.bytes(result[0]),'uint8_t',Number(a.length(result[0]))));try{return bytes.toString();}finally{bytes.fill(0);}}
    finally{a.release(result[0]);}
  });
}
export function removeOwnerSecret(service){return query(service,(a,dict)=>{const status=a.remove(dict);if(status!==0&&status!==-25300)throw Error('OnlyPrivacy keychain cleanup failed ('+status+')');});}
