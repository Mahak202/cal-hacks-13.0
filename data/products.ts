export type Category = 'bed'|'rug'|'pendants'|'sideTables'|'bench'|'planter'|'artwork'|'curtains'|'chair'|'fan'|'outdoorPlanter'|'outdoorChair'|'pergola'|'stringLights'
export type Tier = 'premium'|'mid'|'budget'
export type Product = {
 id:string;name:string;category:Category;store:string;price:number;url:string;imageUrl:string
 material:string;durability:number;styleTags:string[];tier:Tier
 rating?:number;reviewsCount?:number
 originalPrice?:number|null;availability?:string;scrapedAt?:string
}
const catalog:Record<Category,[number,number,number]>={
 bed:[1690,890,429],rug:[640,260,119],pendants:[360,160,58],sideTables:[340,150,69],
 bench:[520,240,99],planter:[380,170,65],artwork:[450,180,45],curtains:[420,140,49],
 chair:[680,320,89],fan:[560,240,99],
 outdoorPlanter:[280,120,45],outdoorChair:[540,260,95],pergola:[2400,1100,180],stringLights:[90,45,19],
}
const details:Record<Category,{names:string[];stores:string[];materials:string[]}>={
 bed:{names:['Drommen Reclaimed Platform Bed','Lenia Low Oak Bed','Tarva Lightwood Platform'],stores:['CB2','Article','IKEA'],materials:['Reclaimed oak & linen','Solid oak','Light pine']},
 rug:{names:['Chunky Handwoven Jute 9×12','Arvin Natural Jute 9×12','Woven Jute 7×10'],stores:['Pottery Barn','West Elm','Target'],materials:['Handwoven jute','Braided jute','Jute blend']},
 pendants:{names:['Soren Rattan Pendant Pair','Auburn Woven Pendant Pair','Misterhult Pendant Pair'],stores:['Etsy','Article','IKEA'],materials:['Handwoven rattan','Natural cane','Bamboo']},
 sideTables:{names:['Emmett Oak Drum Tables','Volume Round Side Tables','Carved Wood Accent Pair'],stores:['Pottery Barn','Article','Wayfair'],materials:['Reclaimed oak','Solid oak','Mango wood']},
 bench:{names:['Folsom Reclaimed Bed Bench','Plank Oak Bench','Natural Wood Bench'],stores:['Pottery Barn','West Elm','Target'],materials:['Reclaimed wood','FSC oak','Rubberwood']},
 planter:{names:['Heritage Olive Tree & Stone Pot','Faux Olive in Cement Pot','Olive Tree & Resin Planter'],stores:['Etsy','West Elm','Target'],materials:['Live olive & stoneware','Faux olive & cement','Faux olive & resin']},
 artwork:{names:['Earth Study Original Canvas','Neutral Fields Canvas','Textured Abstract Print'],stores:['Etsy','CB2','Wayfair'],materials:['Pigment on raw canvas','Hand-painted canvas','Printed canvas']},
 curtains:{names:['Oatmeal Linen Drapery Pair','Sheer White Voile Panels','Grey Roller Blind'],stores:['Pottery Barn','IKEA','Target'],materials:['Heavy linen','Sheer voile','Grey textile']},
 chair:{names:['Bentwood Cane Chair','Bouclé Lounge Chair','Black Café Chair'],stores:['Etsy','West Elm','IKEA'],materials:['Bentwood & cane','Cream bouclé','Powder-coated steel']},
 fan:{names:['Rattan Light Wood Fan','Aerated White Fan','Compact Black Fan'],stores:['Rejuvenation','Wayfair','Home Depot'],materials:['Walnut & rattan','White composite','Black steel']},
 outdoorPlanter:{names:['Cedar Lavender Planter','Acacia Grass Planter','Compact Flower Box'],stores:['Terrain','Wayfair','Target'],materials:['Cedar & lavender','Acacia & grasses','Pine & flowers']},
 outdoorChair:{names:['Teak Outdoor Lounge Chair','Aluminium Patio Chair','Folding Bistro Chair'],stores:['Article','West Elm','IKEA'],materials:['Teak & canvas','Aluminium & mesh','Powder-coated steel']},
 pergola:{names:['Cedar Slatted Pergola','Aluminium Pergola','Canvas Shade Sail'],stores:['Yardistry','Wayfair','IKEA'],materials:['Solid cedar','Aluminium','Outdoor canvas']},
 stringLights:{names:['Brass Café String Lights','Warm Patio Lights','Compact LED String'],stores:['Pottery Barn','Target','IKEA'],materials:['Brass & glass','Black cable & glass','LED & PVC']},
}
const tiers:Tier[]=['premium','mid','budget']
export const products:Product[]=(Object.keys(catalog) as Category[]).flatMap(category=>catalog[category].map((price,i)=>({
 id:`${category}-${tiers[i]}`,name:details[category].names[i],category,store:details[category].stores[i],price,tier:tiers[i],
 url:'#',imageUrl:'/inspo-wabisabi.jpg',material:details[category].materials[i],durability:5-i,
 styleTags:['wabi-sabi','warm','natural',i===0?'artisan':i===1?'japandi':'earthy'],
})))
export const premiumSelection=Object.fromEntries((Object.keys(catalog) as Category[]).map(c=>[c,`${c}-premium`])) as Record<Category,string>

// Apify-sourced live listings get merged into this same array (by id) so the
// existing budget/swap/checkout logic — which all reads from `products` —
// picks them up without any changes.
export function registerLiveProducts(items:{id:string;name:string;category:Category;store:string;price:number;url:string;imageUrl:string;rating?:number;reviewsCount?:number;originalPrice?:number|null;availability?:string;scrapedAt?:string}[]){
 for(const item of items){
  if(products.some(p=>p.id===item.id))continue
  // Real rating (0-5 stars) stands in for the heuristic durability dots
  // used everywhere else, so live listings get genuine signal instead of
  // a flat placeholder.
  products.push({...item,material:'Live listing',durability:item.rating?Math.round(item.rating):3,tier:'mid',styleTags:['live']})
 }
}
