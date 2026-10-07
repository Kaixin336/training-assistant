// Check the container and dimensions before storing private upload bytes.
export function photoType(b:Uint8Array):"image/png"|"image/jpeg"|"image/webp"|null {
 const text=(a:number,z:number)=>new TextDecoder().decode(b.subarray(a,z));
 const view=new DataView(b.buffer,b.byteOffset,b.byteLength);
 if(b.length>=45&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)){
   if(view.getUint32(8)!==13||text(12,16)!=="IHDR"||!view.getUint32(16)||!view.getUint32(20))return null;
   let offset=8,hasData=false,ended=false;
   while(offset+12<=b.length){const size=view.getUint32(offset);if(size>b.length-offset-12)return null;const name=text(offset+4,offset+8);if(name==="IDAT"&&size>0)hasData=true;if(name==="IEND"&&size===0){ended=offset+12===b.length;break;}offset+=size+12;}
   return hasData&&ended?"image/png":null;
 }
 if(b.length>=20&&b[0]===255&&b[1]===216&&b[b.length-2]===255&&b[b.length-1]===217){
   let offset=2,dimensions=false;
   while(offset+4<b.length){if(b[offset]!==255)return null;const marker=b[offset+1];if(marker===218)return dimensions?"image/jpeg":null;const size=view.getUint16(offset+2);if(size<2||offset+2+size>b.length)return null;if([192,193,194].includes(marker)&&size>=8)dimensions=view.getUint16(offset+5)>0&&view.getUint16(offset+7)>0;offset+=2+size;}
 }
 if(b.length>=30&&text(0,4)==="RIFF"&&text(8,12)==="WEBP"&&view.getUint32(4,true)+8===b.length&&["VP8 ","VP8L","VP8X"].includes(text(12,16))&&view.getUint32(16,true)<=b.length-20)return "image/webp";
 return null;
}
