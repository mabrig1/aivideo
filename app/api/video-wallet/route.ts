import {NextRequest,NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {readProviderCredits} from '../../../lib/video-wallet/credits';

export const dynamic='force-dynamic';
export const runtime='nodejs';

function authorized(req:NextRequest):boolean{
  const expected=(process.env.VIDEO_WALLET_TOKEN||'').trim();
  const value=req.headers.get('authorization')||'';
  const actual=value.startsWith('Bearer ')?value.slice(7):'';
  if(expected.length<32||actual.length!==expected.length)return false;
  return timingSafeEqual(Buffer.from(actual,'utf8'),Buffer.from(expected,'utf8'));
}
export async function GET(req:NextRequest){
  if(!authorized(req))return NextResponse.json({error:'Wallet operator authorization required'},{status:401,headers:{'Cache-Control':'no-store'}});
  const providerBalances=await readProviderCredits();
  return NextResponse.json({
    checkedAt:new Date().toISOString(),
    providers:providerBalances,
    statement:'Only verified account API balances are numeric; ChatGPT-connected app balances are separate and unavailable to this server without their own approved bridge. Unknown is never zero or free.',
    autoSpend:false,autoConnect:false,
  },{headers:{'Cache-Control':'private, no-store'}});
}
