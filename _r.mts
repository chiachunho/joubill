import * as echarts from "echarts";
import { writeFileSync } from "node:fs";
import { computeNetTrend } from "./src/lib/stats-core";
import { netSignPieces } from "./src/lib/stats-chart";
const legs=[["2026-05-29",400],["2026-05-29",-150],["2026-05-30",300],["2026-05-30",-100],["2026-06-01",10000],["2026-06-01",-3300],["2026-06-02",-2900],["2026-06-05",-50],["2026-06-10",6500],["2026-06-10",-3200],["2026-06-15",0],["2026-08-01",-30],["2026-09-20",-360]].map(([date,amount])=>({date:date as string,amount:amount as number}));
const pts=computeNetTrend(legs,"2026-05-20","2026-11-20");
console.log(pts);
const data=pts.map(p=>{const[y,m,d]=p.date.split("-").map(Number);return [new Date(y,m-1,d).getTime(),p.net]});
const c=echarts.init(null,null,{renderer:"svg",ssr:true,width:400,height:200});
c.setOption({animation:false,grid:{top:16,right:12,bottom:26,left:48},
xAxis:{type:"time",axisTick:{show:false},axisLabel:{fontSize:11,formatter:{year:"{yyyy}",month:"{M}月",day:"{M}/{d}"}}},
yAxis:{type:"value",splitLine:{lineStyle:{type:"dashed"}},axisLabel:{fontSize:11}},
visualMap:{show:false,dimension:1,pieces:netSignPieces(data.map(([,n])=>n))},
series:[{type:"line",data,step:"end",symbol:"circle",symbolSize:6,lineStyle:{width:2},areaStyle:{opacity:0.16}}]});
writeFileSync(process.argv[2], `<html><body style="margin:0;background:#f2f0eb">${c.renderToSVGString()}</body></html>`);
