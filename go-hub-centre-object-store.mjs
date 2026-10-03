const encoder=new TextEncoder();

function clean(value,max=512){
  const text=String(value==null?"":value).trim();
  return text.slice(0,max);
}
function required(value,label){
  const text=clean(value);
  if(!text)throw Object.assign(new Error(label+" is required"),{status:400});
  return text;
}
function segment(value,label){
  const text=required(value,label);
  if(text==="."||text===".."||/[\u0000-\u001f]/.test(text)){
    throw Object.assign(new Error(label+" is invalid"),{status:400});
  }
  return encodeURIComponent(text);
}
function objectKey({workId,checkpointId,objectId}){
  return "centre/"+segment(workId,"Work ID")+"/"+segment(checkpointId,"Checkpoint ID")+"/"+segment(objectId,"Object ID");
}
async function sha256Hex(bytes){
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  return Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
}
function unavailable(){
  return Object.assign(new Error("CENTRE_OBJECT_STORE_NOT_CONFIGURED"),{status:503});
}
function normalizeHead(object,key){
  if(!object)return null;
  const meta=object.customMetadata&&typeof object.customMetadata==="object"?object.customMetadata:{};
  return {
    ok:true,
    objectKey:key,
    etag:object.etag||null,
    size:Number(object.size||0),
    uploaded:object.uploaded?new Date(object.uploaded).toISOString():null,
    contentType:object.httpMetadata?.contentType||meta.contentType||"application/octet-stream",
    sha256:meta.sha256||null,
    workId:meta.workId||null,
    checkpointId:meta.checkpointId||null,
    objectId:meta.objectId||null,
  };
}

export function createCentreObjectStore({bucket=null}={}){
  function assertBucket(method){
    if(!bucket||typeof bucket[method]!=="function")throw unavailable();
  }

  return Object.freeze({
    async put({workId,checkpointId,objectId,body,contentType="application/octet-stream"}={}){
      assertBucket("put");
      const key=objectKey({workId,checkpointId,objectId});
      const bytes=body instanceof ArrayBuffer
        ? new Uint8Array(body)
        : body instanceof Uint8Array
          ? body
          : new Uint8Array(await new Response(body??"").arrayBuffer());
      const sha256=await sha256Hex(bytes);
      const type=clean(contentType,256)||"application/octet-stream";
      const stored=await bucket.put(key,bytes,{
        httpMetadata:{contentType:type},
        customMetadata:{
          workId:required(workId,"Work ID"),
          checkpointId:required(checkpointId,"Checkpoint ID"),
          objectId:required(objectId,"Object ID"),
          sha256,
          contentType:type,
        },
      });
      const head=normalizeHead(stored,key)||{
        ok:true,objectKey:key,etag:null,size:bytes.byteLength,uploaded:null,contentType:type,
        sha256,workId:required(workId,"Work ID"),checkpointId:required(checkpointId,"Checkpoint ID"),objectId:required(objectId,"Object ID"),
      };
      return {...head,size:bytes.byteLength,sha256};
    },

    async head({workId,checkpointId,objectId}={}){
      assertBucket("head");
      const key=objectKey({workId,checkpointId,objectId});
      return normalizeHead(await bucket.head(key),key);
    },

    async get({workId,checkpointId,objectId}={}){
      assertBucket("get");
      const key=objectKey({workId,checkpointId,objectId});
      const object=await bucket.get(key);
      if(!object)return null;
      const head=normalizeHead(object,key);
      return {head,body:object.body};
    },
  });
}

export { objectKey };
