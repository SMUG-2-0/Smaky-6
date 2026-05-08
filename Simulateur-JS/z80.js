'use strict';
// ═══════════════════════════════════════════════════════════════════
// Z80 CPU emulator — SimSmaky6 web port
// Full instruction set incl. CB/DD/ED/FD/DDCB/FDCB prefixes
// and documented undocumented instructions used by Smaky ROM.
// ═══════════════════════════════════════════════════════════════════

class Z80 {
    static BREAKPOINT_HIT = 1;

    // Flag bit masks
    static SF = 0x80;  // Sign
    static ZF = 0x40;  // Zero
    static YF = 0x20;  // undocumented (bit 5 of result)
    static HF = 0x10;  // Half-carry
    static XF = 0x08;  // undocumented (bit 3 of result)
    static PF = 0x04;  // Parity/Overflow
    static NF = 0x02;  // Subtract
    static CF = 0x01;  // Carry

    constructor() {
        this.mem = new Uint8Array(65536);

        // Main registers
        this.a = 0xFF; this.f = 0xFF;
        this.b = 0; this.c = 0;
        this.d = 0; this.e = 0;
        this.h = 0; this.l = 0;

        // Alternate registers
        this.a_ = 0; this.f_ = 0;
        this.b_ = 0; this.c_ = 0;
        this.d_ = 0; this.e_ = 0;
        this.h_ = 0; this.l_ = 0;

        // Index, stack, PC
        this.ix = 0; this.iy = 0;
        this.sp = 0xFFFF; this.pc = 0;

        // Special
        this.i = 0; this.r = 0;
        this.iff1 = 0; this.iff2 = 0;
        this.im = 0;
        this.halted = false;
        this._eiDelay = false;

        // Breakpoints: Uint8Array for O(1) lookup
        this._bp = new Uint8Array(65536);

        // I/O callbacks
        this.onInput  = null;  // (port16) => byte
        this.onOutput = null;  // (port16, value) => void

        // Execution
        this.ticksToStop = 0;

        // Parity table
        this._par = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            let p = i ^ (i >> 4); p ^= p >> 2; p ^= p >> 1;
            this._par[i] = (~p & 1) << 2;  // PF at bit 2
        }
    }

    // ── Register pairs ─────────────────────────────────────────────
    get af() { return (this.a << 8) | this.f; }
    set af(v) { this.a = (v >> 8) & 0xFF; this.f = v & 0xFF; }
    get bc() { return (this.b << 8) | this.c; }
    set bc(v) { this.b = (v >> 8) & 0xFF; this.c = v & 0xFF; }
    get de() { return (this.d << 8) | this.e; }
    set de(v) { this.d = (v >> 8) & 0xFF; this.e = v & 0xFF; }
    get hl() { return (this.h << 8) | this.l; }
    set hl(v) { this.h = (v >> 8) & 0xFF; this.l = v & 0xFF; }

    // ── Memory ─────────────────────────────────────────────────────
    rb(a)    { return this.mem[a & 0xFFFF]; }
    wb(a, v) { this.mem[a & 0xFFFF] = v & 0xFF; }
    rw(a)    { a &= 0xFFFF; return this.mem[a] | (this.mem[(a+1)&0xFFFF] << 8); }
    ww(a, v) { a &= 0xFFFF; this.mem[a] = v & 0xFF; this.mem[(a+1)&0xFFFF] = (v>>8)&0xFF; }

    // ── Fetch (no R increment — managed in step/exec) ───────────────
    fetch()  { const v = this.mem[this.pc]; this.pc = (this.pc+1)&0xFFFF; return v; }
    fetchd() { const v = this.fetch(); return v < 128 ? v : v - 256; }
    fetchw() { const lo = this.fetch(), hi = this.fetch(); return (hi<<8)|lo; }

    // ── Stack ──────────────────────────────────────────────────────
    push(v) { this.sp=(this.sp-2)&0xFFFF; this.ww(this.sp,v); }
    pop()   { const v=this.rw(this.sp); this.sp=(this.sp+2)&0xFFFF; return v; }

    // ── Breakpoints ────────────────────────────────────────────────
    setBreakpoint(a)   { this._bp[a&0xFFFF] = 1; }
    clearBreakpoint(a) { this._bp[a&0xFFFF] = 0; }

    // ── Interrupt ──────────────────────────────────────────────────
    handleActiveInt() {
        if (!this.iff1) return false;
        this.iff1 = 0; this.iff2 = 0;
        if (this.halted) { this.halted = false; }
        this.push(this.pc);
        switch (this.im) {
            case 0: case 1: this.pc = 0x0038; break;
            case 2: this.pc = this.rw((this.i<<8)|0xFF); break;
        }
        return true;
    }

    // ── Run loop ───────────────────────────────────────────────────
    run() {
        let ticks = 0, events = 0;
        const limit = this.ticksToStop;
        while (ticks < limit) {
            if (this._bp[this.pc]) { events |= Z80.BREAKPOINT_HIT; break; }
            ticks += this._step();
        }
        return events;
    }

    _step() {
        if (this.halted) { this._incR(); return 4; }
        if (this._eiDelay) { this._eiDelay = false; this.iff1 = this.iff2 = 1; }
        this._incR();
        return this._exec(this.fetch());
    }

    _incR() { this.r = ((this.r+1)&0x7F)|(this.r&0x80); }

    // ── 8-bit ALU ──────────────────────────────────────────────────
    _add(v) {
        const a=this.a, r=(a+v)&0xFF;
        this.f = (r&0xA8)|(r?0:Z80.ZF)|((a+v>0xFF)?Z80.CF:0)|
                 (((a&0xF)+(v&0xF))>0xF?Z80.HF:0)|
                 (((a^v^0x80)&(v^r)&0x80)?Z80.PF:0);
        this.a = r;
    }
    _adc(v) {
        const a=this.a, c0=this.f&Z80.CF, r=(a+v+c0)&0xFF;
        this.f = (r&0xA8)|(r?0:Z80.ZF)|((a+v+c0>0xFF)?Z80.CF:0)|
                 (((a&0xF)+(v&0xF)+c0)>0xF?Z80.HF:0)|
                 (((a^v^0x80)&(v^r)&0x80)?Z80.PF:0);
        this.a = r;
    }
    _sub(v) {
        const a=this.a, r=(a-v)&0xFF;
        this.f = (r&0xA8)|(r?0:Z80.ZF)|Z80.NF|(a<v?Z80.CF:0)|
                 (((a&0xF)<(v&0xF))?Z80.HF:0)|
                 (((a^v)&(a^r)&0x80)?Z80.PF:0);
        this.a = r;
    }
    _sbc(v) {
        const a=this.a, c0=this.f&Z80.CF, r=(a-v-c0)&0xFF;
        this.f = (r&0xA8)|(r?0:Z80.ZF)|Z80.NF|((a-v-c0<0)?Z80.CF:0)|
                 (((a&0xF)-(v&0xF)-c0<0)?Z80.HF:0)|
                 (((a^v)&(a^r)&0x80)?Z80.PF:0);
        this.a = r;
    }
    _and(v) { this.a&=v; const r=this.a; this.f=(r&0xA8)|(r?0:Z80.ZF)|Z80.HF|this._par[r]; }
    _or(v)  { this.a|=v; const r=this.a; this.f=(r&0xA8)|(r?0:Z80.ZF)|this._par[r]; }
    _xor(v) { this.a^=v; const r=this.a; this.f=(r&0xA8)|(r?0:Z80.ZF)|this._par[r]; }
    _cp(v)  {
        const a=this.a, r=(a-v)&0xFF;
        this.f = (r&Z80.SF)|(r?0:Z80.ZF)|(v&Z80.YF)|(v&Z80.XF)|Z80.NF|(a<v?Z80.CF:0)|
                 (((a&0xF)<(v&0xF))?Z80.HF:0)|(((a^v)&(a^r)&0x80)?Z80.PF:0);
    }
    _inc(v) {
        const r=(v+1)&0xFF;
        this.f=(r&0xA8)|(r?0:Z80.ZF)|((v&0xF)===0xF?Z80.HF:0)|(v===0x7F?Z80.PF:0)|(this.f&Z80.CF);
        return r;
    }
    _dec(v) {
        const r=(v-1)&0xFF;
        this.f=(r&0xA8)|(r?0:Z80.ZF)|Z80.NF|((v&0xF)===0?Z80.HF:0)|(v===0x80?Z80.PF:0)|(this.f&Z80.CF);
        return r;
    }

    // ── 16-bit ADD HL ──────────────────────────────────────────────
    _addHL(v) {
        const hl=this.hl, r=(hl+v)&0xFFFF;
        this.f=(this.f&(Z80.SF|Z80.ZF|Z80.PF))|((r>>8)&(Z80.YF|Z80.XF))|
               (((hl&0xFFF)+(v&0xFFF))>0xFFF?Z80.HF:0)|(hl+v>0xFFFF?Z80.CF:0);
        this.hl=r; return 11;
    }
    _adcHL(v) {
        const hl=this.hl, c0=this.f&Z80.CF, r=(hl+v+c0)&0xFFFF;
        this.f=((r>>8)&0xA8)|(r?0:Z80.ZF)|(hl+v+c0>0xFFFF?Z80.CF:0)|
               (((hl&0xFFF)+(v&0xFFF)+c0)>0xFFF?Z80.HF:0)|(((~(hl^v))&(v^r)&0x8000)?Z80.PF:0);
        this.hl=r;
    }
    _sbcHL(v) {
        const hl=this.hl, c0=this.f&Z80.CF, r=(hl-v-c0)&0xFFFF;
        this.f=((r>>8)&0xA8)|(r?0:Z80.ZF)|Z80.NF|(hl-v-c0<0?Z80.CF:0)|
               (((hl&0xFFF)-(v&0xFFF)-c0)<0?Z80.HF:0)|(((hl^v)&(hl^r)&0x8000)?Z80.PF:0);
        this.hl=r;
    }

    // ── Rotates/Shifts ─────────────────────────────────────────────
    _rlc(v){ const c=(v>>7)&1,r=((v<<1)|c)&0xFF; this.f=(r&0xA8)|(r?0:Z80.ZF)|this._par[r]|c; return r; }
    _rrc(v){ const c=v&1,r=((v>>1)|(c<<7))&0xFF; this.f=(r&0xA8)|(r?0:Z80.ZF)|this._par[r]|c; return r; }
    _rl(v) { const c0=this.f&Z80.CF,c=(v>>7)&1,r=((v<<1)|c0)&0xFF; this.f=(r&0xA8)|(r?0:Z80.ZF)|this._par[r]|c; return r; }
    _rr(v) { const c0=this.f&Z80.CF,c=v&1,r=((v>>1)|(c0<<7))&0xFF; this.f=(r&0xA8)|(r?0:Z80.ZF)|this._par[r]|c; return r; }
    _sla(v){ const c=(v>>7)&1,r=(v<<1)&0xFF; this.f=(r&0xA8)|(r?0:Z80.ZF)|this._par[r]|c; return r; }
    _sra(v){ const c=v&1,r=(v>>1)|(v&0x80); this.f=(r&0xA8)|(r?0:Z80.ZF)|this._par[r]|c; return r; }
    _sll(v){ const c=(v>>7)&1,r=((v<<1)|1)&0xFF; this.f=(r&0xA8)|(r?0:Z80.ZF)|this._par[r]|c; return r; }
    _srl(v){ const c=v&1,r=v>>1; this.f=(r&0xA8)|(r?0:Z80.ZF)|this._par[r]|c; return r; }

    // ── BIT ────────────────────────────────────────────────────────
    _bit(n,v) {
        const b=(v>>n)&1;
        this.f=(this.f&Z80.CF)|Z80.HF|(v&(Z80.YF|Z80.XF))|(b?0:(Z80.ZF|Z80.PF))|(b&&n===7?Z80.SF:0);
    }

    // ── Register table helpers (B C D E H L (HL) A) ────────────────
    _rr8(r) { switch(r){case 0:return this.b;case 1:return this.c;case 2:return this.d;case 3:return this.e;case 4:return this.h;case 5:return this.l;case 6:return this.rb(this.hl);case 7:return this.a;} }
    _wr8(r,v){ switch(r){case 0:this.b=v;break;case 1:this.c=v;break;case 2:this.d=v;break;case 3:this.e=v;break;case 4:this.h=v;break;case 5:this.l=v;break;case 6:this.wb(this.hl,v);break;case 7:this.a=v;break;} }

    // ── Condition codes (NZ Z NC C PO PE P M) ─────────────────────
    _cc(c) { switch(c){case 0:return!(this.f&Z80.ZF);case 1:return!!(this.f&Z80.ZF);case 2:return!(this.f&Z80.CF);case 3:return!!(this.f&Z80.CF);case 4:return!(this.f&Z80.PF);case 5:return!!(this.f&Z80.PF);case 6:return!(this.f&Z80.SF);case 7:return!!(this.f&Z80.SF);} }

    // ── Main instruction dispatch ──────────────────────────────────
    _exec(op) {
        switch(op) {
            case 0x00: return 4; // NOP
            // LD rp, nn
            case 0x01: this.bc=this.fetchw(); return 10;
            case 0x11: this.de=this.fetchw(); return 10;
            case 0x21: this.hl=this.fetchw(); return 10;
            case 0x31: this.sp=this.fetchw(); return 10;
            // LD (rp), A
            case 0x02: this.wb(this.bc,this.a); return 7;
            case 0x12: this.wb(this.de,this.a); return 7;
            // LD (nn), HL / A
            case 0x22: { const n=this.fetchw(); this.ww(n,this.hl); return 16; }
            case 0x32: { const n=this.fetchw(); this.wb(n,this.a); return 13; }
            // LD A, (rp)
            case 0x0A: this.a=this.rb(this.bc); return 7;
            case 0x1A: this.a=this.rb(this.de); return 7;
            // LD HL/A, (nn)
            case 0x2A: { const n=this.fetchw(); this.hl=this.rw(n); return 16; }
            case 0x3A: { const n=this.fetchw(); this.a=this.rb(n); return 13; }
            // INC rp
            case 0x03: this.bc=(this.bc+1)&0xFFFF; return 6;
            case 0x13: this.de=(this.de+1)&0xFFFF; return 6;
            case 0x23: this.hl=(this.hl+1)&0xFFFF; return 6;
            case 0x33: this.sp=(this.sp+1)&0xFFFF; return 6;
            // DEC rp
            case 0x0B: this.bc=(this.bc-1)&0xFFFF; return 6;
            case 0x1B: this.de=(this.de-1)&0xFFFF; return 6;
            case 0x2B: this.hl=(this.hl-1)&0xFFFF; return 6;
            case 0x3B: this.sp=(this.sp-1)&0xFFFF; return 6;
            // INC r
            case 0x04: this.b=this._inc(this.b); return 4;
            case 0x0C: this.c=this._inc(this.c); return 4;
            case 0x14: this.d=this._inc(this.d); return 4;
            case 0x1C: this.e=this._inc(this.e); return 4;
            case 0x24: this.h=this._inc(this.h); return 4;
            case 0x2C: this.l=this._inc(this.l); return 4;
            case 0x34: this.wb(this.hl,this._inc(this.rb(this.hl))); return 11;
            case 0x3C: this.a=this._inc(this.a); return 4;
            // DEC r
            case 0x05: this.b=this._dec(this.b); return 4;
            case 0x0D: this.c=this._dec(this.c); return 4;
            case 0x15: this.d=this._dec(this.d); return 4;
            case 0x1D: this.e=this._dec(this.e); return 4;
            case 0x25: this.h=this._dec(this.h); return 4;
            case 0x2D: this.l=this._dec(this.l); return 4;
            case 0x35: this.wb(this.hl,this._dec(this.rb(this.hl))); return 11;
            case 0x3D: this.a=this._dec(this.a); return 4;
            // LD r, n
            case 0x06: this.b=this.fetch(); return 7;
            case 0x0E: this.c=this.fetch(); return 7;
            case 0x16: this.d=this.fetch(); return 7;
            case 0x1E: this.e=this.fetch(); return 7;
            case 0x26: this.h=this.fetch(); return 7;
            case 0x2E: this.l=this.fetch(); return 7;
            case 0x36: this.wb(this.hl,this.fetch()); return 10;
            case 0x3E: this.a=this.fetch(); return 7;
            // RLCA RRCA RLA RRA
            case 0x07: { const c=this.a>>7; this.a=((this.a<<1)|c)&0xFF; this.f=(this.f&(Z80.SF|Z80.ZF|Z80.PF))|(this.a&(Z80.YF|Z80.XF))|c; return 4; }
            case 0x0F: { const c=this.a&1; this.a=(this.a>>1)|(c<<7); this.f=(this.f&(Z80.SF|Z80.ZF|Z80.PF))|(this.a&(Z80.YF|Z80.XF))|c; return 4; }
            case 0x17: { const c0=this.f&Z80.CF,c=this.a>>7; this.a=((this.a<<1)|c0)&0xFF; this.f=(this.f&(Z80.SF|Z80.ZF|Z80.PF))|(this.a&(Z80.YF|Z80.XF))|c; return 4; }
            case 0x1F: { const c0=this.f&Z80.CF,c=this.a&1; this.a=(this.a>>1)|(c0<<7); this.f=(this.f&(Z80.SF|Z80.ZF|Z80.PF))|(this.a&(Z80.YF|Z80.XF))|c; return 4; }
            // EX AF, AF'
            case 0x08: { const a=this.a,f=this.f; this.a=this.a_;this.f=this.f_;this.a_=a;this.f_=f; return 4; }
            // ADD HL, rp
            case 0x09: return this._addHL(this.bc);
            case 0x19: return this._addHL(this.de);
            case 0x29: return this._addHL(this.hl);
            case 0x39: return this._addHL(this.sp);
            // DJNZ
            case 0x10: { const e=this.fetchd(); this.b=(this.b-1)&0xFF; if(this.b){this.pc=(this.pc+e)&0xFFFF;return 13;} return 8; }
            // JR / JR cc
            case 0x18: { const e=this.fetchd(); this.pc=(this.pc+e)&0xFFFF; return 12; }
            case 0x20: { const e=this.fetchd(); if(!(this.f&Z80.ZF)){this.pc=(this.pc+e)&0xFFFF;return 12;} return 7; }
            case 0x28: { const e=this.fetchd(); if(this.f&Z80.ZF){this.pc=(this.pc+e)&0xFFFF;return 12;} return 7; }
            case 0x30: { const e=this.fetchd(); if(!(this.f&Z80.CF)){this.pc=(this.pc+e)&0xFFFF;return 12;} return 7; }
            case 0x38: { const e=this.fetchd(); if(this.f&Z80.CF){this.pc=(this.pc+e)&0xFFFF;return 12;} return 7; }
            // DAA
            case 0x27: {
                let a=this.a; const f=this.f; let cf=f&Z80.CF;
                if(!(f&Z80.NF)){
                    if((f&Z80.HF)||(a&0xF)>9) a+=6;
                    if(cf||a>0x99){a+=0x60;cf=Z80.CF;}
                } else {
                    if(f&Z80.HF) a-=6;
                    if(cf) a-=0x60;
                }
                a&=0xFF;
                this.f=(a&0xA8)|(a?0:Z80.ZF)|(f&Z80.NF)|this._par[a]|cf;
                this.a=a; return 4;
            }
            // CPL
            case 0x2F: this.a^=0xFF; this.f=(this.f&(Z80.SF|Z80.ZF|Z80.PF|Z80.CF))|(this.a&(Z80.YF|Z80.XF))|Z80.HF|Z80.NF; return 4;
            // SCF
            case 0x37: this.f=(this.f&(Z80.SF|Z80.ZF|Z80.PF))|(this.a&(Z80.YF|Z80.XF))|Z80.CF; return 4;
            // CCF
            case 0x3F: { const c=this.f&Z80.CF; this.f=(this.f&(Z80.SF|Z80.ZF|Z80.PF))|(this.a&(Z80.YF|Z80.XF))|(c?Z80.HF:0)|(c^Z80.CF); return 4; }
            // HALT
            case 0x76: this.halted=true; this.pc=(this.pc-1)&0xFFFF; return 4;
            // ADD ADC SUB SBC AND XOR OR CP immediate
            case 0xC6: this._add(this.fetch()); return 7;
            case 0xCE: this._adc(this.fetch()); return 7;
            case 0xD6: this._sub(this.fetch()); return 7;
            case 0xDE: this._sbc(this.fetch()); return 7;
            case 0xE6: this._and(this.fetch()); return 7;
            case 0xEE: this._xor(this.fetch()); return 7;
            case 0xF6: this._or(this.fetch()); return 7;
            case 0xFE: this._cp(this.fetch()); return 7;
            // ADD ADC SUB SBC AND XOR OR CP (HL)
            case 0x86: this._add(this.rb(this.hl)); return 7;
            case 0x8E: this._adc(this.rb(this.hl)); return 7;
            case 0x96: this._sub(this.rb(this.hl)); return 7;
            case 0x9E: this._sbc(this.rb(this.hl)); return 7;
            case 0xA6: this._and(this.rb(this.hl)); return 7;
            case 0xAE: this._xor(this.rb(this.hl)); return 7;
            case 0xB6: this._or(this.rb(this.hl)); return 7;
            case 0xBE: this._cp(this.rb(this.hl)); return 7;
            // ADD ADC SUB SBC AND XOR OR CP registers
            case 0x80:this._add(this.b);return 4; case 0x81:this._add(this.c);return 4; case 0x82:this._add(this.d);return 4; case 0x83:this._add(this.e);return 4; case 0x84:this._add(this.h);return 4; case 0x85:this._add(this.l);return 4; case 0x87:this._add(this.a);return 4;
            case 0x88:this._adc(this.b);return 4; case 0x89:this._adc(this.c);return 4; case 0x8A:this._adc(this.d);return 4; case 0x8B:this._adc(this.e);return 4; case 0x8C:this._adc(this.h);return 4; case 0x8D:this._adc(this.l);return 4; case 0x8F:this._adc(this.a);return 4;
            case 0x90:this._sub(this.b);return 4; case 0x91:this._sub(this.c);return 4; case 0x92:this._sub(this.d);return 4; case 0x93:this._sub(this.e);return 4; case 0x94:this._sub(this.h);return 4; case 0x95:this._sub(this.l);return 4; case 0x97:this._sub(this.a);return 4;
            case 0x98:this._sbc(this.b);return 4; case 0x99:this._sbc(this.c);return 4; case 0x9A:this._sbc(this.d);return 4; case 0x9B:this._sbc(this.e);return 4; case 0x9C:this._sbc(this.h);return 4; case 0x9D:this._sbc(this.l);return 4; case 0x9F:this._sbc(this.a);return 4;
            case 0xA0:this._and(this.b);return 4; case 0xA1:this._and(this.c);return 4; case 0xA2:this._and(this.d);return 4; case 0xA3:this._and(this.e);return 4; case 0xA4:this._and(this.h);return 4; case 0xA5:this._and(this.l);return 4; case 0xA7:this._and(this.a);return 4;
            case 0xA8:this._xor(this.b);return 4; case 0xA9:this._xor(this.c);return 4; case 0xAA:this._xor(this.d);return 4; case 0xAB:this._xor(this.e);return 4; case 0xAC:this._xor(this.h);return 4; case 0xAD:this._xor(this.l);return 4; case 0xAF:this._xor(this.a);return 4;
            case 0xB0:this._or(this.b);return 4;  case 0xB1:this._or(this.c);return 4;  case 0xB2:this._or(this.d);return 4;  case 0xB3:this._or(this.e);return 4;  case 0xB4:this._or(this.h);return 4;  case 0xB5:this._or(this.l);return 4;  case 0xB7:this._or(this.a);return 4;
            case 0xB8:this._cp(this.b);return 4;  case 0xB9:this._cp(this.c);return 4;  case 0xBA:this._cp(this.d);return 4;  case 0xBB:this._cp(this.e);return 4;  case 0xBC:this._cp(this.h);return 4;  case 0xBD:this._cp(this.l);return 4;  case 0xBF:this._cp(this.a);return 4;
            // RET cc
            case 0xC0:if(!(this.f&Z80.ZF)){this.pc=this.pop();return 11;}return 5;
            case 0xC8:if(this.f&Z80.ZF){this.pc=this.pop();return 11;}return 5;
            case 0xD0:if(!(this.f&Z80.CF)){this.pc=this.pop();return 11;}return 5;
            case 0xD8:if(this.f&Z80.CF){this.pc=this.pop();return 11;}return 5;
            case 0xE0:if(!(this.f&Z80.PF)){this.pc=this.pop();return 11;}return 5;
            case 0xE8:if(this.f&Z80.PF){this.pc=this.pop();return 11;}return 5;
            case 0xF0:if(!(this.f&Z80.SF)){this.pc=this.pop();return 11;}return 5;
            case 0xF8:if(this.f&Z80.SF){this.pc=this.pop();return 11;}return 5;
            // POP
            case 0xC1:this.bc=this.pop();return 10; case 0xD1:this.de=this.pop();return 10; case 0xE1:this.hl=this.pop();return 10; case 0xF1:this.af=this.pop();return 10;
            // PUSH
            case 0xC5:this.push(this.bc);return 11; case 0xD5:this.push(this.de);return 11; case 0xE5:this.push(this.hl);return 11; case 0xF5:this.push(this.af);return 11;
            // JP cc, nn
            case 0xC2:{const n=this.fetchw();if(!(this.f&Z80.ZF))this.pc=n;return 10;}
            case 0xCA:{const n=this.fetchw();if(this.f&Z80.ZF)this.pc=n;return 10;}
            case 0xD2:{const n=this.fetchw();if(!(this.f&Z80.CF))this.pc=n;return 10;}
            case 0xDA:{const n=this.fetchw();if(this.f&Z80.CF)this.pc=n;return 10;}
            case 0xE2:{const n=this.fetchw();if(!(this.f&Z80.PF))this.pc=n;return 10;}
            case 0xEA:{const n=this.fetchw();if(this.f&Z80.PF)this.pc=n;return 10;}
            case 0xF2:{const n=this.fetchw();if(!(this.f&Z80.SF))this.pc=n;return 10;}
            case 0xFA:{const n=this.fetchw();if(this.f&Z80.SF)this.pc=n;return 10;}
            // JP nn
            case 0xC3: this.pc=this.fetchw(); return 10;
            // CALL cc, nn
            case 0xC4:{const n=this.fetchw();if(!(this.f&Z80.ZF)){this.push(this.pc);this.pc=n;return 17;}return 10;}
            case 0xCC:{const n=this.fetchw();if(this.f&Z80.ZF){this.push(this.pc);this.pc=n;return 17;}return 10;}
            case 0xD4:{const n=this.fetchw();if(!(this.f&Z80.CF)){this.push(this.pc);this.pc=n;return 17;}return 10;}
            case 0xDC:{const n=this.fetchw();if(this.f&Z80.CF){this.push(this.pc);this.pc=n;return 17;}return 10;}
            case 0xE4:{const n=this.fetchw();if(!(this.f&Z80.PF)){this.push(this.pc);this.pc=n;return 17;}return 10;}
            case 0xEC:{const n=this.fetchw();if(this.f&Z80.PF){this.push(this.pc);this.pc=n;return 17;}return 10;}
            case 0xF4:{const n=this.fetchw();if(!(this.f&Z80.SF)){this.push(this.pc);this.pc=n;return 17;}return 10;}
            case 0xFC:{const n=this.fetchw();if(this.f&Z80.SF){this.push(this.pc);this.pc=n;return 17;}return 10;}
            // CALL nn
            case 0xCD:{const n=this.fetchw();this.push(this.pc);this.pc=n;return 17;}
            // RET
            case 0xC9: this.pc=this.pop(); return 10;
            // EXX
            case 0xD9:{let t;t=this.b;this.b=this.b_;this.b_=t;t=this.c;this.c=this.c_;this.c_=t;t=this.d;this.d=this.d_;this.d_=t;t=this.e;this.e=this.e_;this.e_=t;t=this.h;this.h=this.h_;this.h_=t;t=this.l;this.l=this.l_;this.l_=t;return 4;}
            // JP (HL)
            case 0xE9: this.pc=this.hl; return 4;
            // LD SP, HL
            case 0xF9: this.sp=this.hl; return 6;
            // EX (SP), HL
            case 0xE3:{const t=this.rw(this.sp);this.ww(this.sp,this.hl);this.hl=t;return 19;}
            // EX DE, HL
            case 0xEB:{const t=this.de;this.de=this.hl;this.hl=t;return 4;}
            // DI / EI
            case 0xF3: this.iff1=this.iff2=0; return 4;
            case 0xFB: this._eiDelay=true; return 4;
            // RST
            case 0xC7:this.push(this.pc);this.pc=0x00;return 11;
            case 0xCF:this.push(this.pc);this.pc=0x08;return 11;
            case 0xD7:this.push(this.pc);this.pc=0x10;return 11;
            case 0xDF:this.push(this.pc);this.pc=0x18;return 11;
            case 0xE7:this.push(this.pc);this.pc=0x20;return 11;
            case 0xEF:this.push(this.pc);this.pc=0x28;return 11;
            case 0xF7:this.push(this.pc);this.pc=0x30;return 11;
            case 0xFF:this.push(this.pc);this.pc=0x38;return 11;
            // IN A,(n)
            case 0xDB:{const n=this.fetch();this.a=this.onInput?this.onInput((this.a<<8)|n)&0xFF:0;return 11;}
            // OUT (n),A
            case 0xD3:{const n=this.fetch();if(this.onOutput)this.onOutput((this.a<<8)|n,this.a);return 11;}
            // Prefixes
            case 0xCB: return this._execCB();
            case 0xDD: this._incR(); return this._execXY('ix');
            case 0xFD: this._incR(); return this._execXY('iy');
            case 0xED: this._incR(); return this._execED();
            default:
                // 0x40-0x7F: LD r,r'
                if(op>=0x40&&op<=0x7F){const d=(op>>3)&7,s=op&7;this._wr8(d,this._rr8(s));return(d===6||s===6)?7:4;}
                return 4;
        }
    }

    // ── CB prefix ──────────────────────────────────────────────────
    _execCB() {
        this._incR();
        const op=this.fetch(), r=op&7, n=(op>>3)&7;
        let v=this._rr8(r), tHL=(r===6);
        switch(op>>6){
            case 0:
                switch(n){case 0:v=this._rlc(v);break;case 1:v=this._rrc(v);break;case 2:v=this._rl(v);break;case 3:v=this._rr(v);break;case 4:v=this._sla(v);break;case 5:v=this._sra(v);break;case 6:v=this._sll(v);break;case 7:v=this._srl(v);break;}
                this._wr8(r,v); return tHL?15:8;
            case 1:
                this._bit(n,v);
                if(tHL)this.f=(this.f&~(Z80.YF|Z80.XF))|(this.h&(Z80.YF|Z80.XF));
                return tHL?12:8;
            case 2: this._wr8(r,v&~(1<<n)); return tHL?15:8;
            case 3: this._wr8(r,v|(1<<n));  return tHL?15:8;
        }
    }

    // ── DD/FD prefix ───────────────────────────────────────────────
    _execXY(xy) {
        const isIX=(xy==='ix');
        const XY=()=>isIX?this.ix:this.iy;
        const sXY=(v)=>{ if(isIX)this.ix=v;else this.iy=v; };
        const op=this.fetch();
        const xy16=XY(), xyh=(xy16>>8)&0xFF, xyl=xy16&0xFF;

        switch(op){
            case 0x09:{const r=(xy16+this.bc)&0xFFFF;const c=xy16+this.bc>0xFFFF?Z80.CF:0;const h=((xy16&0xFFF)+(this.bc&0xFFF))>0xFFF?Z80.HF:0;this.f=(this.f&(Z80.SF|Z80.ZF|Z80.PF))|((r>>8)&(Z80.YF|Z80.XF))|h|c;sXY(r);return 15;}
            case 0x19:{const r=(xy16+this.de)&0xFFFF;const c=xy16+this.de>0xFFFF?Z80.CF:0;const h=((xy16&0xFFF)+(this.de&0xFFF))>0xFFF?Z80.HF:0;this.f=(this.f&(Z80.SF|Z80.ZF|Z80.PF))|((r>>8)&(Z80.YF|Z80.XF))|h|c;sXY(r);return 15;}
            case 0x29:{const r=(xy16+xy16)&0xFFFF;const c=xy16+xy16>0xFFFF?Z80.CF:0;const h=((xy16&0xFFF)+(xy16&0xFFF))>0xFFF?Z80.HF:0;this.f=(this.f&(Z80.SF|Z80.ZF|Z80.PF))|((r>>8)&(Z80.YF|Z80.XF))|h|c;sXY(r);return 15;}
            case 0x39:{const r=(xy16+this.sp)&0xFFFF;const c=xy16+this.sp>0xFFFF?Z80.CF:0;const h=((xy16&0xFFF)+(this.sp&0xFFF))>0xFFF?Z80.HF:0;this.f=(this.f&(Z80.SF|Z80.ZF|Z80.PF))|((r>>8)&(Z80.YF|Z80.XF))|h|c;sXY(r);return 15;}
            case 0x21: sXY(this.fetchw()); return 14;
            case 0x22:{const n=this.fetchw();this.ww(n,xy16);return 20;}
            case 0x2A:{const n=this.fetchw();sXY(this.rw(n));return 20;}
            case 0x23: sXY((xy16+1)&0xFFFF); return 10;
            case 0x2B: sXY((xy16-1)&0xFFFF); return 10;
            // INC/DEC XYh XYl (undocumented)
            case 0x24:{const r=this._inc(xyh);sXY((r<<8)|xyl);return 8;}
            case 0x25:{const r=this._dec(xyh);sXY((r<<8)|xyl);return 8;}
            case 0x26:{sXY((this.fetch()<<8)|xyl);return 11;}
            case 0x2C:{const r=this._inc(xyl);sXY((xyh<<8)|r);return 8;}
            case 0x2D:{const r=this._dec(xyl);sXY((xyh<<8)|r);return 8;}
            case 0x2E:{sXY((xyh<<8)|this.fetch());return 11;}
            // INC/DEC/LD (XY+d)
            case 0x34:{const d=this.fetchd(),a=(xy16+d)&0xFFFF;this.wb(a,this._inc(this.rb(a)));return 23;}
            case 0x35:{const d=this.fetchd(),a=(xy16+d)&0xFFFF;this.wb(a,this._dec(this.rb(a)));return 23;}
            case 0x36:{const d=this.fetchd(),n=this.fetch();this.wb((xy16+d)&0xFFFF,n);return 19;}
            // LD r, (XY+d)
            case 0x46:{const d=this.fetchd();this.b=this.rb((xy16+d)&0xFFFF);return 19;}
            case 0x4E:{const d=this.fetchd();this.c=this.rb((xy16+d)&0xFFFF);return 19;}
            case 0x56:{const d=this.fetchd();this.d=this.rb((xy16+d)&0xFFFF);return 19;}
            case 0x5E:{const d=this.fetchd();this.e=this.rb((xy16+d)&0xFFFF);return 19;}
            case 0x66:{const d=this.fetchd();this.h=this.rb((xy16+d)&0xFFFF);return 19;}
            case 0x6E:{const d=this.fetchd();this.l=this.rb((xy16+d)&0xFFFF);return 19;}
            case 0x7E:{const d=this.fetchd();this.a=this.rb((xy16+d)&0xFFFF);return 19;}
            // LD r, XYh/XYl (undocumented)
            case 0x44:this.b=xyh;return 8; case 0x45:this.b=xyl;return 8;
            case 0x4C:this.c=xyh;return 8; case 0x4D:this.c=xyl;return 8;
            case 0x54:this.d=xyh;return 8; case 0x55:this.d=xyl;return 8;
            case 0x5C:this.e=xyh;return 8; case 0x5D:this.e=xyl;return 8;
            case 0x7C:this.a=xyh;return 8; case 0x7D:this.a=xyl;return 8;
            // LD XYh/XYl, r (undocumented)
            case 0x60:sXY((this.b<<8)|xyl);return 8; case 0x61:sXY((this.c<<8)|xyl);return 8;
            case 0x62:sXY((this.d<<8)|xyl);return 8; case 0x63:sXY((this.e<<8)|xyl);return 8;
            case 0x64:return 8;                       case 0x65:sXY((xyl<<8)|xyl);return 8;
            case 0x67:sXY((this.a<<8)|xyl);return 8;
            case 0x68:sXY((xyh<<8)|this.b);return 8; case 0x69:sXY((xyh<<8)|this.c);return 8;
            case 0x6A:sXY((xyh<<8)|this.d);return 8; case 0x6B:sXY((xyh<<8)|this.e);return 8;
            case 0x6C:sXY((xyh<<8)|xyh);return 8;    case 0x6D:return 8;
            case 0x6F:sXY((xyh<<8)|this.a);return 8;
            // LD (XY+d), r
            case 0x70:{const d=this.fetchd();this.wb((xy16+d)&0xFFFF,this.b);return 19;}
            case 0x71:{const d=this.fetchd();this.wb((xy16+d)&0xFFFF,this.c);return 19;}
            case 0x72:{const d=this.fetchd();this.wb((xy16+d)&0xFFFF,this.d);return 19;}
            case 0x73:{const d=this.fetchd();this.wb((xy16+d)&0xFFFF,this.e);return 19;}
            case 0x74:{const d=this.fetchd();this.wb((xy16+d)&0xFFFF,this.h);return 19;}
            case 0x75:{const d=this.fetchd();this.wb((xy16+d)&0xFFFF,this.l);return 19;}
            case 0x77:{const d=this.fetchd();this.wb((xy16+d)&0xFFFF,this.a);return 19;}
            // ALU XYh/XYl (undocumented)
            case 0x84:this._add(xyh);return 8; case 0x85:this._add(xyl);return 8;
            case 0x86:{const d=this.fetchd();this._add(this.rb((xy16+d)&0xFFFF));return 19;}
            case 0x8C:this._adc(xyh);return 8; case 0x8D:this._adc(xyl);return 8;
            case 0x8E:{const d=this.fetchd();this._adc(this.rb((xy16+d)&0xFFFF));return 19;}
            case 0x94:this._sub(xyh);return 8; case 0x95:this._sub(xyl);return 8;
            case 0x96:{const d=this.fetchd();this._sub(this.rb((xy16+d)&0xFFFF));return 19;}
            case 0x9C:this._sbc(xyh);return 8; case 0x9D:this._sbc(xyl);return 8;
            case 0x9E:{const d=this.fetchd();this._sbc(this.rb((xy16+d)&0xFFFF));return 19;}
            case 0xA4:this._and(xyh);return 8; case 0xA5:this._and(xyl);return 8;
            case 0xA6:{const d=this.fetchd();this._and(this.rb((xy16+d)&0xFFFF));return 19;}
            case 0xAC:this._xor(xyh);return 8; case 0xAD:this._xor(xyl);return 8;
            case 0xAE:{const d=this.fetchd();this._xor(this.rb((xy16+d)&0xFFFF));return 19;}
            case 0xB4:this._or(xyh);return 8;  case 0xB5:this._or(xyl);return 8;
            case 0xB6:{const d=this.fetchd();this._or(this.rb((xy16+d)&0xFFFF));return 19;}
            case 0xBC:this._cp(xyh);return 8;  case 0xBD:this._cp(xyl);return 8;
            case 0xBE:{const d=this.fetchd();this._cp(this.rb((xy16+d)&0xFFFF));return 19;}
            // POP PUSH EX JP LD SP
            case 0xE1:sXY(this.pop());return 14;
            case 0xE3:{const t=this.rw(this.sp);this.ww(this.sp,xy16);sXY(t);return 23;}
            case 0xE5:this.push(xy16);return 15;
            case 0xE9:this.pc=xy16;return 8;
            case 0xF9:this.sp=xy16;return 10;
            // XYCB
            case 0xCB: return this._execXYCB(xy16);
            // Fallback: treat as plain opcode (DD/FD NOP effect)
            default: return this._exec(op);
        }
    }

    // ── DDCB / FDCB ────────────────────────────────────────────────
    _execXYCB(xy16) {
        const d=this.fetchd(), op=this.fetch();
        const addr=(xy16+d)&0xFFFF;
        let v=this.rb(addr);
        const r=op&7, n=(op>>3)&7;
        switch(op>>6){
            case 0:
                switch(n){case 0:v=this._rlc(v);break;case 1:v=this._rrc(v);break;case 2:v=this._rl(v);break;case 3:v=this._rr(v);break;case 4:v=this._sla(v);break;case 5:v=this._sra(v);break;case 6:v=this._sll(v);break;case 7:v=this._srl(v);break;}
                this.wb(addr,v); if(r!==6)this._wr8(r,v); return 23;
            case 1:
                this._bit(n,v);
                this.f=(this.f&~(Z80.YF|Z80.XF))|((addr>>8)&(Z80.YF|Z80.XF));
                return 20;
            case 2: v&=~(1<<n); this.wb(addr,v); if(r!==6)this._wr8(r,v); return 23;
            case 3: v|=(1<<n);  this.wb(addr,v); if(r!==6)this._wr8(r,v); return 23;
        }
    }

    // ── ED prefix ──────────────────────────────────────────────────
    _execED() {
        const op=this.fetch();
        switch(op){
            // IN r,(C)
            case 0x40:{const v=this._inC();this.b=v;return 12;}
            case 0x48:{const v=this._inC();this.c=v;return 12;}
            case 0x50:{const v=this._inC();this.d=v;return 12;}
            case 0x58:{const v=this._inC();this.e=v;return 12;}
            case 0x60:{const v=this._inC();this.h=v;return 12;}
            case 0x68:{const v=this._inC();this.l=v;return 12;}
            case 0x70:this._inC();return 12;
            case 0x78:{const v=this._inC();this.a=v;return 12;}
            // OUT (C),r
            case 0x41:if(this.onOutput)this.onOutput(this.bc,this.b);return 12;
            case 0x49:if(this.onOutput)this.onOutput(this.bc,this.c);return 12;
            case 0x51:if(this.onOutput)this.onOutput(this.bc,this.d);return 12;
            case 0x59:if(this.onOutput)this.onOutput(this.bc,this.e);return 12;
            case 0x61:if(this.onOutput)this.onOutput(this.bc,this.h);return 12;
            case 0x69:if(this.onOutput)this.onOutput(this.bc,this.l);return 12;
            case 0x71:if(this.onOutput)this.onOutput(this.bc,0);return 12;
            case 0x79:if(this.onOutput)this.onOutput(this.bc,this.a);return 12;
            // SBC HL, rp
            case 0x42:this._sbcHL(this.bc);return 15;
            case 0x52:this._sbcHL(this.de);return 15;
            case 0x62:this._sbcHL(this.hl);return 15;
            case 0x72:this._sbcHL(this.sp);return 15;
            // ADC HL, rp
            case 0x4A:this._adcHL(this.bc);return 15;
            case 0x5A:this._adcHL(this.de);return 15;
            case 0x6A:this._adcHL(this.hl);return 15;
            case 0x7A:this._adcHL(this.sp);return 15;
            // LD (nn), rp
            case 0x43:{const n=this.fetchw();this.ww(n,this.bc);return 20;}
            case 0x53:{const n=this.fetchw();this.ww(n,this.de);return 20;}
            case 0x63:{const n=this.fetchw();this.ww(n,this.hl);return 20;}
            case 0x73:{const n=this.fetchw();this.ww(n,this.sp);return 20;}
            // LD rp, (nn)
            case 0x4B:{const n=this.fetchw();this.bc=this.rw(n);return 20;}
            case 0x5B:{const n=this.fetchw();this.de=this.rw(n);return 20;}
            case 0x6B:{const n=this.fetchw();this.hl=this.rw(n);return 20;}
            case 0x7B:{const n=this.fetchw();this.sp=this.rw(n);return 20;}
            // NEG
            case 0x44:case 0x4C:case 0x54:case 0x5C:
            case 0x64:case 0x6C:case 0x74:case 0x7C:{const a=this.a;this.a=0;this._sub(a);return 8;}
            // RETN / RETI
            case 0x45:case 0x55:case 0x65:case 0x75:
                this.iff1=this.iff2; this.pc=this.pop(); return 14;
            case 0x4D: this.iff1=this.iff2; this.pc=this.pop(); return 14;
            // IM
            case 0x46:case 0x4E:case 0x66:case 0x6E: this.im=0; return 8;
            case 0x56:case 0x76: this.im=1; return 8;
            case 0x5E:case 0x7E: this.im=2; return 8;
            // LD I/R, A
            case 0x47: this.i=this.a; return 9;
            case 0x4F: this.r=this.a; return 9;
            // LD A, I/R
            case 0x57: this.a=this.i; this.f=(this.f&Z80.CF)|(this.a&0xA8)|(this.a?0:Z80.ZF)|(this.iff2?Z80.PF:0); return 9;
            case 0x5F: this.a=this.r&0xFF; this.f=(this.f&Z80.CF)|(this.a&0xA8)|(this.a?0:Z80.ZF)|(this.iff2?Z80.PF:0); return 9;
            // RLD / RRD
            case 0x6F:{const v=this.rb(this.hl);this.wb(this.hl,((v<<4)|(this.a&0xF))&0xFF);this.a=(this.a&0xF0)|(v>>4);this.f=(this.f&Z80.CF)|(this.a&0xA8)|(this.a?0:Z80.ZF)|this._par[this.a];return 18;}
            case 0x67:{const v=this.rb(this.hl);this.wb(this.hl,((this.a<<4)|(v>>4))&0xFF);this.a=(this.a&0xF0)|(v&0xF);this.f=(this.f&Z80.CF)|(this.a&0xA8)|(this.a?0:Z80.ZF)|this._par[this.a];return 18;}
            // Block instructions
            case 0xA0:return this._ldi();  case 0xA8:return this._ldd();
            case 0xB0:return this._ldir(); case 0xB8:return this._lddr();
            case 0xA1:return this._cpi();  case 0xA9:return this._cpd();
            case 0xB1:return this._cpir(); case 0xB9:return this._cpdr();
            case 0xA2:return this._ini();  case 0xAA:return this._ind();
            case 0xB2:return this._inir(); case 0xBA:return this._indr();
            case 0xA3:return this._outi(); case 0xAB:return this._outd();
            case 0xB3:return this._otir(); case 0xBB:return this._otdr();
            default: return 8;
        }
    }

    _inC() {
        const v=this.onInput?this.onInput(this.bc)&0xFF:0;
        this.f=(this.f&Z80.CF)|(v&0xA8)|(v?0:Z80.ZF)|this._par[v];
        return v;
    }

    // ── Block instructions ─────────────────────────────────────────
    _ldi()  { const v=this.rb(this.hl); this.wb(this.de,v); this.hl=(this.hl+1)&0xFFFF; this.de=(this.de+1)&0xFFFF; this.bc=(this.bc-1)&0xFFFF; const n=(this.a+v)&0xFF; this.f=(this.f&(Z80.SF|Z80.ZF|Z80.CF))|(n&Z80.XF)|((n<<4)&Z80.YF)|(this.bc?Z80.PF:0); return 16; }
    _ldd()  { const v=this.rb(this.hl); this.wb(this.de,v); this.hl=(this.hl-1)&0xFFFF; this.de=(this.de-1)&0xFFFF; this.bc=(this.bc-1)&0xFFFF; const n=(this.a+v)&0xFF; this.f=(this.f&(Z80.SF|Z80.ZF|Z80.CF))|(n&Z80.XF)|((n<<4)&Z80.YF)|(this.bc?Z80.PF:0); return 16; }
    _ldir() { this._ldi(); if(this.bc){this.pc=(this.pc-2)&0xFFFF;return 21;} return 16; }
    _lddr() { this._ldd(); if(this.bc){this.pc=(this.pc-2)&0xFFFF;return 21;} return 16; }
    _cpi()  { const v=this.rb(this.hl),r=(this.a-v)&0xFF,h=(this.a&0xF)<(v&0xF)?Z80.HF:0; this.hl=(this.hl+1)&0xFFFF; this.bc=(this.bc-1)&0xFFFF; const n=(r-(h?1:0))&0xFF; this.f=(r&Z80.SF)|(r?0:Z80.ZF)|h|(this.bc?Z80.PF:0)|Z80.NF|(this.f&Z80.CF)|(n&Z80.XF)|((n<<4)&Z80.YF); return 16; }
    _cpd()  { const v=this.rb(this.hl),r=(this.a-v)&0xFF,h=(this.a&0xF)<(v&0xF)?Z80.HF:0; this.hl=(this.hl-1)&0xFFFF; this.bc=(this.bc-1)&0xFFFF; const n=(r-(h?1:0))&0xFF; this.f=(r&Z80.SF)|(r?0:Z80.ZF)|h|(this.bc?Z80.PF:0)|Z80.NF|(this.f&Z80.CF)|(n&Z80.XF)|((n<<4)&Z80.YF); return 16; }
    _cpir() { this._cpi(); if(this.bc&&!(this.f&Z80.ZF)){this.pc=(this.pc-2)&0xFFFF;return 21;} return 16; }
    _cpdr() { this._cpd(); if(this.bc&&!(this.f&Z80.ZF)){this.pc=(this.pc-2)&0xFFFF;return 21;} return 16; }
    _ini()  { const v=this.onInput?this.onInput(this.bc)&0xFF:0; this.wb(this.hl,v); this.b=(this.b-1)&0xFF; this.hl=(this.hl+1)&0xFFFF; this.f=(this.b&0xA8)|(this.b?0:Z80.ZF)|Z80.NF; return 16; }
    _ind()  { const v=this.onInput?this.onInput(this.bc)&0xFF:0; this.wb(this.hl,v); this.b=(this.b-1)&0xFF; this.hl=(this.hl-1)&0xFFFF; this.f=(this.b&0xA8)|(this.b?0:Z80.ZF)|Z80.NF; return 16; }
    _inir() { this._ini(); if(this.b){this.pc=(this.pc-2)&0xFFFF;return 21;} return 16; }
    _indr() { this._ind(); if(this.b){this.pc=(this.pc-2)&0xFFFF;return 21;} return 16; }
    _outi() { const v=this.rb(this.hl); this.b=(this.b-1)&0xFF; if(this.onOutput)this.onOutput(this.bc,v); this.hl=(this.hl+1)&0xFFFF; this.f=(this.b&0xA8)|(this.b?0:Z80.ZF)|Z80.NF; return 16; }
    _outd() { const v=this.rb(this.hl); this.b=(this.b-1)&0xFF; if(this.onOutput)this.onOutput(this.bc,v); this.hl=(this.hl-1)&0xFFFF; this.f=(this.b&0xA8)|(this.b?0:Z80.ZF)|Z80.NF; return 16; }
    _otir() { this._outi(); if(this.b){this.pc=(this.pc-2)&0xFFFF;return 21;} return 16; }
    _otdr() { this._outd(); if(this.b){this.pc=(this.pc-2)&0xFFFF;return 21;} return 16; }
}

// Node.js / browser dual compatibility
if (typeof module !== 'undefined') module.exports = Z80;
else window.Z80 = Z80;
