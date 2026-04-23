'use strict';
// Verify ethereumFetcher.js pool addresses before deployment.
// Tests: token ordering, price sanity, SushiSwap pool discovery.
require('dotenv').config();
const { ethers } = require('ethers');
const { createProvider } = require('./utils/provider_factory');
const rpc = createProvider('ethereum');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ZERO = '0x0000000000000000000000000000000000000000';

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const WBTC = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';
const DAI  = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

// SushiSwap V3 factory on Ethereum mainnet
const SUSHI_FACTORY_ETH = '0xbACEB8eC6b9355Dfc0269C18bac9d6E2Bdc29C4f';
const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const SLOT0_ABI = ['function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)','function liquidity() view returns (uint128)','function token0() view returns (address)','function token1() view returns (address)'];

function sqrtToPrice(sqrtP96, dec0, dec1, mode) {
  const sqrtP = Number(sqrtP96) / (2**96);
  const raw = sqrtP * sqrtP * Math.pow(10, dec0 - dec1);
  return mode === 'invert' ? 1/raw : raw;
}

const UNI_POOLS = [
  { name:'ETH/USDC 0.05%', pool:'0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', d0:6,  d1:18, mode:'invert', min:500,   max:20000  },
  { name:'ETH/USDC 0.30%', pool:'0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8', d0:6,  d1:18, mode:'invert', min:500,   max:20000  },
  { name:'ETH/USDC 0.01%', pool:'0xE0554a476A092703abdB3Ef35c80e0D76d32939F', d0:6,  d1:18, mode:'invert', min:500,   max:20000  },
  { name:'ETH/USDT 0.05%', pool:'0x11b815efB8f581194ae79006d24E0d814B7697F6', d0:18, d1:6,  mode:'direct', min:500,   max:20000  },
  { name:'ETH/USDT 0.30%', pool:'0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36', d0:18, d1:6,  mode:'direct', min:500,   max:20000  },
  { name:'ETH/USDT 0.01%', pool:'0xC5aF84701f98Fa483eCe78aF83F11b6C38ACA71d', d0:18, d1:6,  mode:'direct', min:500,   max:20000  },
  { name:'WBTC/USDC 0.30%',pool:'0x99ac8cA7087fA4A2A1FB6357269965A2014ABc35', d0:8,  d1:6,  mode:'direct', min:10000, max:100000 },
  { name:'WBTC/USDC 0.05%',pool:'0x9a772018FbD77fcD2d25657e5C547BAfF3Fd7D16', d0:8,  d1:6,  mode:'direct', min:10000, max:100000 },
  { name:'WBTC/ETH  0.30%',pool:'0xCBCdF9626bC03E24f779434178A73a0B4bad62eD', d0:8,  d1:18, mode:'direct', min:1,     max:1000   },
  { name:'DAI/USDC  0.01%',pool:'0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168', d0:18, d1:6,  mode:'direct', min:0.9,   max:1.1    },
  { name:'DAI/USDC  0.05%',pool:'0x6c6Bc977E13Df9b0de53b251522280BB72383700', d0:18, d1:6,  mode:'direct', min:0.9,   max:1.1    },
];

const SUSHI_PROBES = [
  { label:'ETH/USDC 0.05%', a:USDC, b:WETH, fee:500  },
  { label:'ETH/USDC 0.30%', a:USDC, b:WETH, fee:3000 },
  { label:'ETH/USDT 0.05%', a:WETH, b:USDT, fee:500  },
  { label:'WBTC/USDC 0.30%',a:WBTC, b:USDC, fee:3000 },
];

async function main() {
  const { blockNumber } = await rpc.getBlockNumber('verify.block', {timeoutMs:8000, hedge:true});
  console.log(`\n[eth-verify] block=${blockNumber}`);

  console.log('\n=== UNISWAP V3 POOL VERIFICATION ===');
  console.log(`${'pool'.padEnd(20)}${'price'.padEnd(14)}${'sanity'.padEnd(10)}${'t0'.padEnd(44)}status`);
  console.log('-'.repeat(100));
  for (const p of UNI_POOLS) {
    await sleep(400);
    try {
      const {result} = await rpc.callDetailed(`v.${p.pool.slice(0,8)}`, async pr => {
        const c = new ethers.Contract(p.pool, SLOT0_ABI, pr);
        const [s, liq, t0] = await Promise.all([c.slot0(), c.liquidity(), c.token0()]);
        return {s, liq, t0};
      }, {timeoutMs:8000, hedge:true});
      const price = sqrtToPrice(result.s[0], p.d0, p.d1, p.mode);
      const ok = price >= p.min && price <= p.max;
      const liqOk = Number(result.liq) > 0;
      const marker = ok && liqOk ? '✅' : ok ? '⚠ zero liq' : '❌ bad price';
      const px = price > 100 ? `$${price.toFixed(2)}` : price.toFixed(6);
      console.log(`${p.name.padEnd(20)}${px.padEnd(14)}${marker.padEnd(10)}${result.t0.padEnd(44)}`);
    } catch(e) { console.log(`${p.name.padEnd(20)}${'ERR'.padEnd(14)}❌          ${e.message.slice(0,50)}`); }
  }

  console.log('\n=== SUSHISWAP V3 ETHEREUM FACTORY PROBE ===');
  console.log(`factory: ${SUSHI_FACTORY_ETH}`);
  console.log(`${'pair'.padEnd(20)}${'pool'.padEnd(44)}${'price'.padEnd(14)}status`);
  console.log('-'.repeat(90));
  for (const p of SUSHI_PROBES) {
    await sleep(400);
    try {
      const {result} = await rpc.callDetailed(`sf.${p.label}`, async pr =>
        new ethers.Contract(SUSHI_FACTORY_ETH, FACTORY_ABI, pr).getPool(p.a, p.b, p.fee),
        {timeoutMs:8000, hedge:false});
      const addr = result?.toString();
      if (!addr || addr === ZERO) { console.log(`${p.label.padEnd(20)}${'zero'.padEnd(44)} ⚪ no pool`); continue; }
      await sleep(300);
      const {result:pr2} = await rpc.callDetailed(`sv.${addr.slice(0,8)}`, async pr => {
        const c = new ethers.Contract(addr, SLOT0_ABI, pr);
        const [s,liq,t0] = await Promise.all([c.slot0(), c.liquidity(), c.token0()]);
        return {s,liq,t0};
      }, {timeoutMs:8000, hedge:true});
      // Determine dec ordering from t0
      const t0lower = pr2.t0.toLowerCase();
      const isUSDCt0 = t0lower === USDC.toLowerCase();
      const isWBTCt0 = t0lower === WBTC.toLowerCase();
      const isWETHt0 = t0lower === WETH.toLowerCase();
      let d0,d1,mode;
      if (isUSDCt0) { d0=6;d1=18;mode='invert'; }
      else if (isWBTCt0) { d0=8;d1=6;mode='direct'; }
      else if (isWETHt0) { d0=18;d1=6;mode='direct'; }
      else { d0=18;d1=6;mode='direct'; }
      const price = sqrtToPrice(pr2.s[0], d0, d1, mode);
      const liqOk = Number(pr2.liq) > 0;
      const marker = liqOk ? '✅' : '⚠ zero liq';
      const px = price > 100 ? `$${price.toFixed(2)}` : price.toFixed(6);
      console.log(`${p.label.padEnd(20)}${addr.padEnd(44)}${px.padEnd(14)}${marker}  t0=${pr2.t0.slice(0,12)}`);
    } catch(e) { console.log(`${p.label.padEnd(20)}${'ERR'.padEnd(44)} ❌ ${e.message.slice(0,50)}`); }
  }
  console.log('\n');
  process.exit(0);
}
main().catch(e => { console.error('[FATAL]',e.message); process.exit(1); });
