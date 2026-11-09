import type {PackingSize} from './rect-packing.ts';
export type ResponsiveProfile={width:number;minHeight:number}[];
export function responsivePackingSizes(catalog:PackingSize[],profiles:Map<string,ResponsiveProfile>){
  return catalog.flatMap(card=>{
    const body=card.solidHeight??card.height,caption=card.height-body;
    return (profiles.get(card.key)??[]).flatMap(sample=>{
      const h=Math.max(body*.85,sample.minHeight);
      if(sample.width<card.width*.85-1e-6 || sample.width>card.width*1.15+1e-6 || h>body*1.15+1e-6)return [];
      return [{key:card.key,width:sample.width,height:h+caption,solidHeight:h}];
    });
  });
}
