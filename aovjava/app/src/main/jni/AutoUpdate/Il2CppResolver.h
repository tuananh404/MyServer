#pragma once

#include <jni.h>
#include <dlfcn.h>
#include <link.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <dirent.h>
#include <pthread.h>
#include <android/log.h>
#include <inttypes.h>
#include <vector>
#include <map>
#include <chrono>
#include <fstream>
#include <thread>
#include <libgen.h>
#include <sys/uio.h>
#include <elf.h>
#include <sys/system_properties.h>
#include <EGL/egl.h>
#include <GLES3/gl3.h>
#include <unordered_map>
#include <string>
#include <atomic>

// ─── Typedefs (must precede Il2CppString) ─────────────────────────────────────
typedef unsigned short UTF16;
typedef wchar_t        UTF32;
typedef char           UTF8;

// ─── Il2CppString ─────────────────────────────────────────────────────────────
struct Il2CppString {
    void    *klass;
    void    *monitor;
    int32_t  length;
    UTF16    start_char;
    const char    *CString();
    const wchar_t *WCString();
    static Il2CppString *Create(const char *s);
    static Il2CppString *Create(const wchar_t *s, int len);
};

// ─── IL2Cpp public API ─────────────────────────────────────────────────────────
namespace IL2Cpp {
    void   Il2CppAttach();
    void  *Il2CppGetImageByName(const char *image);
    void  *Il2CppGetClassType(const char *image, const char *ns, const char *clazz);
    void   Il2CppGetStaticFieldValue(const char *image, const char *ns, const char *clazz, const char *name, void *output);
    void   Il2CppSetStaticFieldValue(const char *image, const char *ns, const char *clazz, const char *name, void *value);
    void  *Il2CppGetMethodOffset(const char *image, const char *ns, const char *clazz, const char *name, int argc);
    size_t Il2CppGetFieldOffset(const char *image, const char *ns, const char *clazz, const char *name);
}

#define targetLib OBFUSCATE("libil2cpp.so")

// ─── Internal function pointers ────────────────────────────────────────────────
namespace {
    Il2CppString *(*il2cpp_string_new)(const char *)                                    = nullptr;
    Il2CppString *(*il2cpp_string_new_utf16)(const wchar_t *, int32_t)                 = nullptr;
    void        **(*il2cpp_domain_get_assemblies)(const void *, size_t *)              = nullptr;
    void         *(*il2cpp_domain_get)()                                               = nullptr;
    const void   *(*il2cpp_assembly_get_image)(const void *)                           = nullptr;
    const char   *(*il2cpp_image_get_name)(void *)                                    = nullptr;
    void         *(*il2cpp_class_from_name)(const void *, const char *, const char *) = nullptr;
    void         *(*il2cpp_class_get_field_from_name)(void *, const char *)           = nullptr;
    void          (*il2cpp_field_static_get_value)(void *, void *)                    = nullptr;
    void          (*il2cpp_field_static_set_value)(void *, void *)                    = nullptr;
    void         *(*il2cpp_class_get_method_from_name)(void *, const char *, int)     = nullptr;
    size_t        (*il2cpp_field_get_offset)(void *)                                   = nullptr;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Anti-debug / Anti-Frida guard
// ═══════════════════════════════════════════════════════════════════════════════
namespace _guard {

__attribute__((visibility("hidden")))
static inline bool _is_traced() {
    char buf[256] = {0};
    int fd = open(OBFUSCATE("/proc/self/status"), O_RDONLY);
    if (fd < 0) return false;
    ssize_t n = read(fd, buf, sizeof(buf)-1);
    close(fd);
    if (n <= 0) return false;
    const char *p = buf;
    while (*p) {
        if (p[0]=='T'&&p[1]=='r'&&p[2]=='a'&&p[3]=='c'&&p[4]=='e'&&
            p[5]=='r'&&p[6]=='P'&&p[7]=='i'&&p[8]=='d'&&p[9]==':') {
            p += 10;
            while (*p==' '||*p=='\t') p++;
            return (*p!='0'||(*(p+1)!='\n'&&*(p+1)!='\0'));
        }
        p++;
    }
    return false;
}

__attribute__((visibility("hidden")))
static inline bool _frida_present() {
    FILE *maps = fopen(OBFUSCATE("/proc/self/maps"), "r");
    if (!maps) return false;
    char line[512]; bool found = false;
    while (!found && fgets(line, sizeof(line), maps)) {
        if (strstr(line, OBFUSCATE("frida"))     ||
            strstr(line, OBFUSCATE("linjector")) ||
            strstr(line, OBFUSCATE("gum-js")))    found = true;
    }
    fclose(maps);
    return found;
}

__attribute__((visibility("hidden")))
static inline void _halt_if_compromised() {
    if (_is_traced() || _frida_present()) {
        pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
        pthread_mutex_lock(&m);
        pthread_mutex_lock(&m); // silent deadlock
    }
}

} // namespace _guard

// ─── FNV-1a 64-bit hash ────────────────────────────────────────────────────────
__attribute__((visibility("hidden")))
static inline uint64_t _fnv1a3(const char *a, const char *b, const char *c) {
    uint64_t h = 14695981039346656037ULL;
    auto mix = [&](const char *s){ while(*s){ h^=(uint8_t)*s++; h*=1099511628211ULL; } };
    mix(a); mix(b ? b : ""); mix(c);
    return h;
}

// ─── IL2Cpp implementations ────────────────────────────────────────────────────
void *IL2Cpp::Il2CppGetImageByName(const char *image) {
    if (!il2cpp_domain_get_assemblies || !il2cpp_domain_get) return nullptr;
    size_t sz = 0;
    void **asm_ = il2cpp_domain_get_assemblies(il2cpp_domain_get(), &sz);
    if (!asm_) return nullptr;
    for (size_t i = 0; i < sz; i++) {
        void *img = (void *)il2cpp_assembly_get_image(asm_[i]);
        if (!img) continue;
        const char *nm = il2cpp_image_get_name(img);
        if (nm && strcmp(nm, image) == 0) return img;
    }
    return nullptr;
}

void *IL2Cpp::Il2CppGetClassType(const char *image, const char *ns, const char *clazz) {
    static pthread_mutex_t _mtx = PTHREAD_MUTEX_INITIALIZER;
    static std::unordered_map<uint64_t, void*> _cache;
    uint64_t key = _fnv1a3(image, ns, clazz);
    pthread_mutex_lock(&_mtx);
    auto it = _cache.find(key);
    if (it != _cache.end()) { void *r=it->second; pthread_mutex_unlock(&_mtx); return r; }
    pthread_mutex_unlock(&_mtx);
    void *img = Il2CppGetImageByName(image);
    if (!img) return nullptr;
    void *klass = il2cpp_class_from_name(img, ns, clazz);
    if (!klass) return nullptr;
    pthread_mutex_lock(&_mtx); _cache[key]=klass; pthread_mutex_unlock(&_mtx);
    return klass;
}

struct _FI { void *klass, *field; };

void IL2Cpp::Il2CppGetStaticFieldValue(const char *img,const char *ns,const char *clazz,const char *name,void *out){
    _FI fi; fi.klass=Il2CppGetClassType(img,ns,clazz); if(!fi.klass) return;
    fi.field=il2cpp_class_get_field_from_name(fi.klass,name); if(!fi.field) return;
    il2cpp_field_static_get_value(fi.field,out);
}
void IL2Cpp::Il2CppSetStaticFieldValue(const char *img,const char *ns,const char *clazz,const char *name,void *val){
    _FI fi; fi.klass=Il2CppGetClassType(img,ns,clazz); if(!fi.klass) return;
    fi.field=il2cpp_class_get_field_from_name(fi.klass,name); if(!fi.field) return;
    il2cpp_field_static_set_value(fi.field,val);
}

// ─── UTF conversion (no deprecated codecvt) ────────────────────────────────────
__attribute__((visibility("hidden")))
static std::string _u16_to_u8(const UTF16 *src, size_t len) {
    std::string r; r.reserve(len*3);
    for (size_t i=0;i<len;) {
        uint32_t cp; UTF16 w1=src[i++];
        if (w1>=0xD800u&&w1<=0xDBFFu&&i<len) {
            UTF16 w2=src[i];
            if (w2>=0xDC00u&&w2<=0xDFFFu){cp=0x10000u+((uint32_t)(w1-0xD800u)<<10)+(w2-0xDC00u);++i;}
            else cp=w1;
        } else cp=w1;
        if      (cp<0x80u)    r+=(char)cp;
        else if (cp<0x800u)   {r+=(char)(0xC0|(cp>>6));r+=(char)(0x80|(cp&0x3F));}
        else if (cp<0x10000u) {r+=(char)(0xE0|(cp>>12));r+=(char)(0x80|((cp>>6)&0x3F));r+=(char)(0x80|(cp&0x3F));}
        else {r+=(char)(0xF0|(cp>>18));r+=(char)(0x80|((cp>>12)&0x3F));r+=(char)(0x80|((cp>>6)&0x3F));r+=(char)(0x80|(cp&0x3F));}
    }
    return r;
}
const char *utf16_to_utf8(const UTF16 *src, size_t len) {
    thread_local std::string _buf; _buf=_u16_to_u8(src,len); return _buf.c_str();
}
const wchar_t *utf16_to_utf32(const UTF16 *src, size_t len) {
    auto *out=new UTF32[len+1];
    for (size_t i=0;i<len;i++) {
        UTF16 u=src[i];
        if ((u-0xd800u)<2048u) {
            if ((u&0xfffffc00u)==0xd800u&&((src[i]&0xfffffc00u)==0xdc00u))
                out[i]=((UTF32)u<<10)+src[i]-0x35fdc00u;
            else out[i]=L'?';
        } else out[i]=u;
    }
    out[len]=L'\0'; return out;
}
const char    *Il2CppString::CString()               { return utf16_to_utf8(&start_char,length); }
const wchar_t *Il2CppString::WCString()              { return utf16_to_utf32(&start_char,length); }
Il2CppString  *Il2CppString::Create(const char *s)   { return il2cpp_string_new(s); }
Il2CppString  *Il2CppString::Create(const wchar_t *s,int l){ return il2cpp_string_new_utf16(s,l); }

inline void getPackageName(char *buf, size_t sz) {
    FILE *fp=fopen(OBFUSCATE("/proc/self/cmdline"),"r");
    if(fp){if(fgets(buf,sz,fp))buf[strcspn(buf,"\n")]=0;fclose(fp);}
    else strncpy(buf,OBFUSCATE("unknown"),sz);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Unity namespace  -  ELF / metadata scanner
// ═══════════════════════════════════════════════════════════════════════════════
namespace Unity {

#ifndef EI_NIDENT
#define EI_NIDENT 16
#endif
#ifndef PT_LOAD
#define PT_LOAD 1
#define PF_X 1
#define PF_W 2
#define PF_R 4
#endif

#if defined(__LP64__)
typedef Elf64_Ehdr _Elf64_Ehdr;
typedef Elf64_Phdr _Elf64_Phdr;
#else
typedef Elf32_Ehdr _Elf64_Ehdr;
typedef Elf32_Phdr _Elf64_Phdr;
#endif

typedef struct { uint64_t offset,offsetEnd,address,addressEnd; } search_section_t;
typedef struct { search_section_t *items; size_t count,cap; }    section_list_t;

typedef struct {
    uint32_t nameIndex; int32_t assemblyIndex,typeStart; uint32_t typeCount;
    int32_t exportedTypeStart; uint32_t exportedTypeCount;
    int32_t entryPointIndex; uint32_t token; int32_t customAttributeStart; uint32_t customAttributeCount;
} Il2CppImageDefinition;
typedef struct {
    uint32_t nameIndex,namespaceIndex;
    int32_t byvalTypeIndex,declaringTypeIndex,parentIndex,elementTypeIndex,genericContainerIndex;
    uint32_t flags;
    int32_t fieldStart,methodStart,eventStart,propertyStart,nestedTypesStart,
            interfacesStart,vtableStart,interfaceOffsetsStart;
    uint16_t method_count,property_count,field_count,event_count,nested_type_count,
             vtable_count,interfaces_count,interface_offsets_count;
    uint32_t bitfield,token;
} Il2CppTypeDefinition;
typedef struct {
    uint32_t nameIndex; int32_t declaringType,returnType,parameterStart,genericContainerIndex;
    uint32_t token; uint16_t flags,iflags,slot,parameterCount;
} Il2CppMethodDefinition;
typedef struct { uint32_t nameIndex; int32_t typeIndex; uint32_t token; } Il2CppFieldDefinition;
typedef struct {
    uint64_t reversePInvokeWrapperCount,reversePInvokeWrappers;
    uint64_t genericMethodPointersCount,genericMethodPointers,genericAdjustorThunks;
    uint64_t invokerPointersCount,invokerPointers;
    uint64_t unresolvedVirtualCallCount,unresolvedVirtualCallPointers;
    uint64_t interopDataCount,interopData,windowsRuntimeFactoryCount,windowsRuntimeFactoryTable;
    uint64_t codeGenModulesCount,codeGenModules;
} Il2CppCodeRegistration;
typedef struct {
    uint64_t moduleName; int64_t methodPointerCount; uint64_t methodPointers;
    int64_t adjustorThunkCount; uint64_t adjustorThunks,invokerIndices;
    uint64_t reversePInvokeWrapperCount,reversePInvokeWrapperIndices;
    int64_t rgctxRangesCount; uint64_t rgctxRanges; int64_t rgctxsCount;
    uint64_t rgctxs,debuggerMetadata,moduleInitializer,staticConstructorTypeIndices,
             metadataRegistration,codeRegistration;
} Il2CppCodeGenModule;
typedef struct {
    int64_t genericClassesCount; uint64_t genericClasses;
    int64_t genericInstsCount; uint64_t genericInsts;
    int64_t genericMethodTableCount; uint64_t genericMethodTable;
    int64_t typesCount; uint64_t types; int64_t methodSpecsCount; uint64_t methodSpecs;
    int64_t fieldOffsetsCount; uint64_t fieldOffsets;
    int64_t typeDefinitionsSizesCount; uint64_t typeDefinitionsSizes;
    uint64_t metadataUsagesCount,metadataUsages;
} Il2CppMetadataRegistration;
typedef struct { uint8_t *data; size_t size; bool is_mmap; } file_buffer_t;
typedef struct {
    uint64_t image_base,code_reg_va,meta_reg_va;
    file_buffer_t unity,meta; section_list_t exec_secs,data_secs;
    const uint32_t *hdr;
} unity_cache_t;

// ─── CRC32 integrity check ─────────────────────────────────────────────────────
__attribute__((visibility("hidden")))
static inline uint32_t _crc32(const uint8_t *d, size_t n) {
    uint32_t c=0xFFFFFFFFu;
    for(size_t i=0;i<n;i++){c^=d[i];for(int j=0;j<8;j++)c=(c>>1)^(0xEDB88320u&(uint32_t)(-(int32_t)(c&1)));}
    return c^0xFFFFFFFFu;
}

// ─── File / section helpers ────────────────────────────────────────────────────
__attribute__((visibility("hidden")))
inline bool read_file(const char *path, file_buffer_t *out) {
    if(!path||!path[0]||!out) return false;
    int fd=open(path,O_RDONLY); if(fd<0) return false;
    struct stat st;
    if(fstat(fd,&st)!=0||st.st_size<=0){close(fd);return false;}
    size_t sz=(size_t)st.st_size;
    void *data=mmap(NULL,sz,PROT_READ,MAP_PRIVATE,fd,0); close(fd);
    if(data==MAP_FAILED) return false;
    out->data=(uint8_t*)data; out->size=sz; out->is_mmap=true; return true;
}
__attribute__((visibility("hidden")))
inline void free_file(file_buffer_t *b){
    if(!b||!b->data) return;
    if(b->is_mmap) munmap(b->data,b->size);
    b->data=NULL; b->size=0; b->is_mmap=false;
}
__attribute__((visibility("hidden")))
inline void sec_push(section_list_t *l, search_section_t s){
    if(!l) return;
    if(l->count==l->cap){
        size_t nc=l->cap?l->cap*2:8;
        search_section_t *ni=(search_section_t*)realloc(l->items,nc*sizeof(*ni));
        if(!ni) return; l->items=ni; l->cap=nc;
    }
    l->items[l->count++]=s;
}
__attribute__((visibility("hidden")))
inline void sec_free(section_list_t *l){
    if(!l||!l->items) return; free(l->items); l->items=NULL; l->count=0; l->cap=0;
}
__attribute__((visibility("hidden")))
inline uint32_t _xsub(uint32_t v,uint32_t s,uint32_t k){return((v-s)^k);}

// ─── Metadata deobfuscation ────────────────────────────────────────────────────
__attribute__((visibility("hidden")))
inline bool deobf_meta(file_buffer_t *meta) {
    if(!meta||!meta->data||meta->size<0x100) return false;
    uint32_t *h=(uint32_t*)meta->data;
    if(h[0]!=0xEAB11BAFu||h[1]<29) return false;
    if(meta->is_mmap){
        uint8_t *cp=(uint8_t*)malloc(meta->size); if(!cp) return false;
        memcpy(cp,meta->data,meta->size); munmap(meta->data,meta->size);
        meta->data=cp; meta->is_mmap=false; h=(uint32_t*)meta->data;
    }
    uint32_t in[64],out[64]={0}; memcpy(in,h,sizeof(in));
    out[0]=in[0]; out[1]=in[1]; for(int i=50;i<64;i++) out[i]=in[i];
    out[4]=in[2]^0xA8C72D; out[5]=in[3]^0xA8C72D;
    out[8] =_xsub(in[4],  3,0xA8C72E); out[9] =_xsub(in[5],  7,0xA8C72F);
    out[12]=_xsub(in[6],  6,0xA8C72F); out[13]=_xsub(in[7], 14,0xA8C731);
    out[16]=_xsub(in[8],  9,0xA8C730); out[17]=_xsub(in[9], 21,0xA8C733);
    out[20]=_xsub(in[10],12,0xA8C731); out[21]=_xsub(in[11],28,0xA8C735);
    out[6] =_xsub(in[12],15,0xA8C732); out[7] =_xsub(in[13],35,0xA8C737);
    out[10]=_xsub(in[14],18,0xA8C733); out[11]=_xsub(in[15],42,0xA8C739);
    out[14]=_xsub(in[16],21,0xA8C734); out[15]=_xsub(in[17],49,0xA8C73B);
    out[18]=_xsub(in[18],24,0xA8C735); out[19]=_xsub(in[19],56,0xA8C73D);
    out[22]=_xsub(in[20],27,0xA8C736); out[23]=_xsub(in[21],63,0xA8C73F);
    out[2] =_xsub(in[22],30,0xA8C737); out[3] =_xsub(in[23],70,0xA8C741);
    out[48]=_xsub(in[24],33,0xA8C738); out[49]=_xsub(in[25],77,0xA8C743);
    out[46]=_xsub(in[26],36,0xA8C739); out[47]=_xsub(in[27],84,0xA8C745);
    out[44]=_xsub(in[28],39,0xA8C73A); out[45]=_xsub(in[29],91,0xA8C747);
    out[42]=_xsub(in[30],42,0xA8C73B); out[43]=_xsub(in[31],98,0xA8C749);
    out[24]=_xsub(in[32],45,0xA8C73C); out[25]=_xsub(in[33],105,0xA8C74B);
    out[28]=_xsub(in[34],48,0xA8C73D); out[29]=_xsub(in[35],112,0xA8C74D);
    out[32]=_xsub(in[36],51,0xA8C73E); out[33]=_xsub(in[37],119,0xA8C74F);
    out[36]=_xsub(in[38],54,0xA8C73F); out[37]=_xsub(in[39],126,0xA8C751);
    out[40]=_xsub(in[40],57,0xA8C740); out[41]=_xsub(in[41],133,0xA8C753);
    out[26]=_xsub(in[42],60,0xA8C741); out[27]=_xsub(in[43],140,0xA8C755);
    out[30]=_xsub(in[44],63,0xA8C742); out[31]=_xsub(in[45],147,0xA8C757);
    out[34]=_xsub(in[46],66,0xA8C743); out[35]=_xsub(in[47],154,0xA8C759);
    out[38]=_xsub(in[48],69,0xA8C744); out[39]=_xsub(in[49],161,0xA8C75B);
    memcpy(h,out,sizeof(out)); h[0]=0xFAB11BAFu; return true;
}

// ─── ELF parser ────────────────────────────────────────────────────────────────
__attribute__((visibility("hidden")))
inline bool parse_elf(const file_buffer_t *buf, section_list_t *ex, section_list_t *da, uint64_t *base){
    if(!buf||!buf->data||buf->size<sizeof(_Elf64_Ehdr)||!ex||!da) return false;
    const _Elf64_Ehdr *e=(const _Elf64_Ehdr*)buf->data;
    if(e->e_ident[0]!=0x7F||e->e_ident[1]!='E'||e->e_ident[2]!='L'||e->e_ident[3]!='F') return false;
#if defined(__LP64__)
    if(e->e_ident[4]!=2||e->e_ident[5]!=1) return false;
#else
    if(e->e_ident[4]!=1||e->e_ident[5]!=1) return false;
#endif
    if(!e->e_phoff||!e->e_phnum||e->e_phentsize<sizeof(_Elf64_Phdr)) return false;
    if(e->e_phoff+(uint64_t)e->e_phnum*e->e_phentsize>buf->size) return false;
    uint64_t ib=UINT64_MAX; const uint8_t *ps=buf->data+e->e_phoff;
    for(uint16_t i=0;i<e->e_phnum;i++){
        const _Elf64_Phdr *ph=(const _Elf64_Phdr*)(ps+i*e->e_phentsize);
        if(ph->p_type!=PT_LOAD||ph->p_offset+ph->p_filesz>buf->size||!ph->p_filesz) continue;
        search_section_t s={ph->p_offset,ph->p_offset+ph->p_filesz,ph->p_vaddr,ph->p_vaddr+ph->p_memsz};
        if(ph->p_flags&PF_X) sec_push(ex,s); else sec_push(da,s);
        if(ph->p_vaddr<ib) ib=ph->p_vaddr;
    }
    if(base) *base=(ib==UINT64_MAX)?0:ib;
    return ex->count>0&&da->count>0;
}

typedef struct { uintptr_t base; uint64_t min_va,max_end; section_list_t *ex,*da; bool found; } _lctx;

__attribute__((visibility("hidden")))
static int _dl_cb(struct dl_phdr_info *info, size_t, void *data){
    _lctx *c=(_lctx*)data;
    if(!info||!info->dlpi_name||!c) return 0;
    if(!strstr(info->dlpi_name,OBFUSCATE("libil2cpp.so"))) return 0;
    c->base=(uintptr_t)info->dlpi_addr; c->min_va=UINT64_MAX; c->max_end=0;
    for(int i=0;i<info->dlpi_phnum;i++){
        const ElfW(Phdr) *ph=&info->dlpi_phdr[i];
        if(ph->p_type!=PT_LOAD||!ph->p_memsz) continue;
        uint64_t rs=(uint64_t)c->base+ph->p_vaddr, re=rs+ph->p_memsz;
        search_section_t s={ph->p_vaddr,ph->p_vaddr+ph->p_memsz,rs,re};
        if(ph->p_flags&PF_X) sec_push(c->ex,s); else sec_push(c->da,s);
        if(ph->p_vaddr<c->min_va) c->min_va=ph->p_vaddr;
        if(ph->p_vaddr+ph->p_memsz>c->max_end) c->max_end=ph->p_vaddr+ph->p_memsz;
    }
    c->found=(c->ex->count>0&&c->da->count>0&&c->max_end>0);
    return c->found?1:0;
}

__attribute__((visibility("hidden")))
static bool _load_mem(file_buffer_t *ub, section_list_t *ex, section_list_t *da, uint64_t *brt){
    if(!ub||!ex||!da) return false;
    _lctx ctx={0}; ctx.ex=ex; ctx.da=da;
    dl_iterate_phdr(_dl_cb,&ctx);
    if(!ctx.found||!ctx.base) return false;
    ub->data=(uint8_t*)ctx.base; ub->size=(size_t)ctx.max_end; ub->is_mmap=false;
    if(brt) *brt=(ctx.min_va==UINT64_MAX)?(uint64_t)ctx.base:(uint64_t)ctx.base+ctx.min_va;
    return true;
}

// ─── VA helpers ────────────────────────────────────────────────────────────────
__attribute__((visibility("hidden")))
inline bool va_to_off(const section_list_t *s,uint64_t va,uint64_t *off){
    if(!s||!off) return false;
    for(size_t i=0;i<s->count;i++){
        const search_section_t *x=&s->items[i];
        if(va>=x->address&&va<x->addressEnd){uint64_t o=x->offset+(va-x->address);if(o<x->offsetEnd){*off=o;return true;}}
    }
    return false;
}
__attribute__((visibility("hidden")))
inline bool va_to_off_any(const section_list_t *da,const section_list_t *ex,uint64_t va,uint64_t *off){return va_to_off(da,va,off)||va_to_off(ex,va,off);}
__attribute__((visibility("hidden")))
inline bool off_to_va(const section_list_t *s,uint64_t off,uint64_t *va){
    if(!s||!va) return false;
    for(size_t i=0;i<s->count;i++){const search_section_t *x=&s->items[i];if(off>=x->offset&&off<x->offsetEnd){*va=x->address+(off-x->offset);return true;}}
    return false;
}
__attribute__((visibility("hidden")))
inline bool va_in(const section_list_t *s,uint64_t va){
    if(!s) return false;
    for(size_t i=0;i<s->count;i++){const search_section_t *x=&s->items[i];if(va>=x->address&&va<x->addressEnd)return true;}
    return false;
}

const char *metadata_string(const file_buffer_t *meta, const uint32_t *hdr, uint32_t idx);

__attribute__((visibility("hidden")))
inline bool find_bytes(const uint8_t *d,size_t dl,const uint8_t *p,size_t pl,size_t *pos){
    if(!d||!p||!pl||dl<pl||!pos) return false;
    for(size_t i=0;i+pl<=dl;i++) if(memcmp(d+i,p,pl)==0){*pos=i;return true;}
    return false;
}
__attribute__((visibility("hidden")))
inline size_t find_refs(const file_buffer_t *buf,const section_list_t *da,uint64_t tv,uint64_t *out,size_t mx){
    if(!buf||!buf->data||!da||!out) return 0; size_t cnt=0;
    for(size_t i=0;i<da->count;i++){
        const search_section_t *s=&da->items[i]; if(s->offsetEnd>buf->size) continue;
        for(uint64_t o=s->offset;o+8<=s->offsetEnd;o+=8)
            if(*(const uint64_t*)(buf->data+o)==tv){if(cnt<mx)out[cnt++]=s->address+(o-s->offset);}
    }
    return cnt;
}
__attribute__((visibility("hidden")))
static int _img_names(const file_buffer_t *m,const uint32_t *h,const char **out,int mx){
    if(!m||!h||!out||mx<=0) return 0;
    uint32_t io=h[42],is=h[43]; if(io+is>m->size) return 0;
    const Il2CppImageDefinition *imgs=(const Il2CppImageDefinition*)(m->data+io);
    int n=0,cnt=is/(int)sizeof(Il2CppImageDefinition);
    for(int i=0;i<cnt&&n<mx;i++){const char *nm=metadata_string(m,h,imgs[i].nameIndex);if(nm)out[n++]=nm;}
    return n;
}

__attribute__((visibility("hidden")))
inline bool find_code_reg(const file_buffer_t *ub,const section_list_t *ex,const section_list_t *da,
                           int ic,const file_buffer_t *mb,const uint32_t *hdr,uint64_t *out){
    if(!ub||!ub->data||!ex||!da||!mb||!hdr||!out) return false;
    const uint8_t feat[]={0x6D,0x73,0x63,0x6F,0x72,0x6C,0x69,0x62,0x2E,0x64,0x6C,0x6C,0x00};
    size_t pos=0,mx=4096;
    uint64_t *r1=(uint64_t*)malloc(mx*8),*r2=(uint64_t*)malloc(mx*8),*r3=(uint64_t*)malloc(mx*8);
    if(!r1||!r2||!r3){free(r1);free(r2);free(r3);return false;}
    while(pos<ub->size){
        size_t rel=0;
        if(!find_bytes(ub->data+pos,ub->size-pos,feat,sizeof(feat),&rel)) break;
        pos+=rel; uint64_t dv=0;
        if(!off_to_va(ex,pos,&dv)&&!off_to_va(da,pos,&dv)){pos++;continue;}
        size_t c1=find_refs(ub,da,dv,r1,mx);
        for(size_t i=0;i<c1;i++){
            size_t c2=find_refs(ub,da,r1[i],r2,mx);
            for(size_t j=0;j<c2;j++){
                for(int k=ic-1;k>=0;k--){
                    uint64_t nd=r2[j]-(uint64_t)k*8;
                    size_t c3=find_refs(ub,da,nd,r3,mx);
                    for(size_t n=0;n<c3;n++){
                        uint64_t cv=r3[n]-8,co=0;
                        if(!va_to_off(da,cv,&co)||co+8>ub->size) continue;
                        if(*(const int64_t*)(ub->data+co)==ic){
                            *out=r3[n]-112; free(r1);free(r2);free(r3);return true;
                        }
                    }
                }
            }
        }
        pos++;
    }
    free(r1);free(r2);free(r3);
    const int MX=512; const char *inames[MX]; int inc=_img_names(mb,hdr,inames,MX);
    for(size_t si=0;si<da->count;si++){
        const search_section_t *s=&da->items[si];
        for(uint64_t o=s->offset;o+sizeof(Il2CppCodeRegistration)<=s->offsetEnd;o+=8){
            const Il2CppCodeRegistration *cr=(const Il2CppCodeRegistration*)(ub->data+o);
            if(cr->codeGenModulesCount<=0||cr->codeGenModulesCount>4096||!cr->codeGenModules) continue;
            uint64_t mo=0; if(!va_to_off_any(da,ex,cr->codeGenModules,&mo)) continue;
            if(mo+(uint64_t)cr->codeGenModulesCount*8>ub->size) continue;
            int match=0,chk=(cr->codeGenModulesCount<5)?(int)cr->codeGenModulesCount:5;
            for(int i=0;i<chk;i++){
                uint64_t mva=*(const uint64_t*)(ub->data+mo+(uint64_t)i*8),moff=0;
                if(!va_to_off_any(da,ex,mva,&moff)||moff+sizeof(Il2CppCodeGenModule)>ub->size) continue;
                const Il2CppCodeGenModule *md=(const Il2CppCodeGenModule*)(ub->data+moff);
                if(!md->moduleName) continue;
                uint64_t no=0; if(!va_to_off_any(da,ex,md->moduleName,&no)||no>=ub->size) continue;
                const char *mn=(const char*)(ub->data+no); if(!mn||!mn[0]) continue;
                for(int k=0;k<inc;k++) if(strcmp(mn,inames[k])==0){match++;break;}
            }
            if(match>0){*out=s->address+(o-s->offset);return true;}
        }
    }
    return false;
}

__attribute__((visibility("hidden")))
inline bool find_meta_reg(const file_buffer_t *ub,const section_list_t *ex,const section_list_t *da,int tdc,uint64_t *out){
    if(!ub||!ub->data||!ex||!da||!out) return false;
    for(size_t si=0;si<da->count;si++){
        const search_section_t *s=&da->items[si]; if(s->offsetEnd<s->offset+32) continue;
        for(uint64_t o=s->offset;o+32<=s->offsetEnd;o+=8){
            if(*(const int64_t*)(ub->data+o)!=(int64_t)tdc) continue;
            if(*(const int64_t*)(ub->data+o+16)!=(int64_t)tdc) continue;
            uint64_t pva=*(const uint64_t*)(ub->data+o+24),po=0;
            if(!va_to_off_any(da,ex,pva,&po)||po+(uint64_t)tdc*8>ub->size) continue;
            bool ok=true;
            for(int i=0;i<tdc;i++){uint64_t v=*(const uint64_t*)(ub->data+po+(uint64_t)i*8);if(!va_in(da,v)&&!va_in(ex,v)){ok=false;break;}}
            if(!ok) continue;
            *out=(s->address+(o-s->offset))-80; return true;
        }
    }
    return false;
}

__attribute__((visibility("hidden")))
inline const char *metadata_string(const file_buffer_t *m,const uint32_t *h,uint32_t idx){
    if(!m||!h) return NULL;
    uint32_t so=h[6],ss=h[7]; if(idx>=ss) return NULL;
    uint32_t off=so+idx; if(off>=(uint32_t)m->size) return NULL;
    return (const char*)(m->data+off);
}

__attribute__((visibility("hidden")))
inline bool find_method_tok(const file_buffer_t *meta,const uint32_t *hdr,
                             const char *img,const char *ns,const char *type,const char *method,int argc,uint32_t *tok){
    if(!meta||!hdr||!img||!type||!method||!tok) return false;
    uint32_t io=hdr[42],is=hdr[43],to=hdr[40],ts=hdr[41],mo=hdr[12],ms=hdr[13];
    if(io+is>meta->size||to+ts>meta->size||mo+ms>meta->size) return false;
    const Il2CppImageDefinition *imgs=(const Il2CppImageDefinition*)(meta->data+io);
    int ic=is/(int)sizeof(Il2CppImageDefinition);
    const Il2CppTypeDefinition *types=(const Il2CppTypeDefinition*)(meta->data+to);
    int tc=ts/(int)sizeof(Il2CppTypeDefinition);
    const Il2CppMethodDefinition *methods=(const Il2CppMethodDefinition*)(meta->data+mo);
    int mc=ms/(int)sizeof(Il2CppMethodDefinition);
    for(int i=0;i<ic;i++){
        const char *in=metadata_string(meta,hdr,imgs[i].nameIndex); if(!in||strcmp(in,img)!=0) continue;
        int ts2=imgs[i].typeStart,te=ts2+(int)imgs[i].typeCount;
        if(ts2<0||ts2>=tc) continue; if(te>tc)te=tc;
        for(int t=ts2;t<te;t++){
            const char *tns=metadata_string(meta,hdr,types[t].namespaceIndex);
            const char *tn=metadata_string(meta,hdr,types[t].nameIndex); if(!tn) continue;
            if(ns&&(!tns||strcmp(tns,ns)!=0)) continue;
            if(strcmp(tn,type)!=0) continue;
            int ms2=types[t].methodStart,me=ms2+(int)types[t].method_count;
            if(ms2<0||ms2>=mc) continue; if(me>mc)me=mc;
            for(int m=ms2;m<me;m++){
                const char *mn=metadata_string(meta,hdr,methods[m].nameIndex);
                if(mn&&strcmp(mn,method)==0){
                    if(argc>=0&&methods[m].parameterCount!=argc) continue;
                    *tok=methods[m].token; return true;
                }
            }
        }
    }
    return false;
}

__attribute__((visibility("hidden")))
inline bool find_field_idx(const file_buffer_t *meta,const uint32_t *hdr,
                            const char *img,const char *ns,const char *type,const char *field,
                            int *ti,int *fi,bool *vt){
    if(!meta||!hdr||!img||!type||!field) return false;
    uint32_t io=hdr[42],is=hdr[43],to=hdr[40],ts=hdr[41],fo=hdr[24],fs=hdr[25];
    if(io+is>meta->size||to+ts>meta->size||fo+fs>meta->size) return false;
    const Il2CppImageDefinition *imgs=(const Il2CppImageDefinition*)(meta->data+io);
    int ic=is/(int)sizeof(Il2CppImageDefinition);
    const Il2CppTypeDefinition *types=(const Il2CppTypeDefinition*)(meta->data+to);
    int tc=ts/(int)sizeof(Il2CppTypeDefinition);
    const Il2CppFieldDefinition *fields=(const Il2CppFieldDefinition*)(meta->data+fo);
    int fc=fs/(int)sizeof(Il2CppFieldDefinition);
    for(int i=0;i<ic;i++){
        const char *in=metadata_string(meta,hdr,imgs[i].nameIndex); if(!in||strcmp(in,img)!=0) continue;
        int ts2=imgs[i].typeStart,te=ts2+(int)imgs[i].typeCount;
        if(ts2<0||ts2>=tc) continue; if(te>tc)te=tc;
        for(int t=ts2;t<te;t++){
            const char *tns=metadata_string(meta,hdr,types[t].namespaceIndex);
            const char *tn=metadata_string(meta,hdr,types[t].nameIndex); if(!tn) continue;
            if(ns&&(!tns||strcmp(tns,ns)!=0)) continue;
            if(strcmp(tn,type)!=0) continue;
            int fs2=types[t].fieldStart,fe=fs2+(int)types[t].field_count;
            if(fs2<0||fs2>=fc) continue; if(fe>fc)fe=fc;
            for(int f=fs2;f<fe;f++){
                const char *fn=metadata_string(meta,hdr,fields[f].nameIndex);
                if(fn&&strcmp(fn,field)==0){
                    if(ti)*ti=t; if(fi)*fi=f-fs2;
                    if(vt)*vt=(types[t].bitfield&0x1)!=0;
                    return true;
                }
            }
        }
    }
    return false;
}

__attribute__((visibility("hidden")))
inline bool get_method_ptr(const file_buffer_t *ub,const section_list_t *da,const section_list_t *ex,
                            uint64_t crva,const char *img,uint32_t tok,uint64_t *out){
    if(!ub||!ub->data||!da||!ex||!img||!out) return false;
    uint64_t co=0; if(!va_to_off_any(da,ex,crva,&co)||co+sizeof(Il2CppCodeRegistration)>ub->size) return false;
    const Il2CppCodeRegistration *cr=(const Il2CppCodeRegistration*)(ub->data+co);
    if(!cr->codeGenModulesCount||!cr->codeGenModules) return false;
    uint64_t mo=0; if(!va_to_off_any(da,ex,cr->codeGenModules,&mo)) return false;
    size_t cnt=(size_t)cr->codeGenModulesCount;
    if(mo+cnt*8>ub->size) return false;
    uint32_t midx=tok&0xFFFFFFu; if(!midx) return false;
    for(size_t i=0;i<cnt;i++){
        uint64_t mva=*(const uint64_t*)(ub->data+mo+i*8),moff=0;
        if(!va_to_off_any(da,ex,mva,&moff)||moff+sizeof(Il2CppCodeGenModule)>ub->size) continue;
        const Il2CppCodeGenModule *md=(const Il2CppCodeGenModule*)(ub->data+moff);
        if(!md->moduleName||!md->methodPointers||md->methodPointerCount<=0) continue;
        uint64_t no=0; if(!va_to_off_any(da,ex,md->moduleName,&no)||no>=ub->size) continue;
        const char *mn=(const char*)(ub->data+no); if(!mn||strcmp(mn,img)!=0) continue;
        if((uint64_t)midx>(uint64_t)md->methodPointerCount) return false;
        uint64_t po=0; if(!va_to_off_any(da,ex,md->methodPointers,&po)) return false;
        if(po+(size_t)md->methodPointerCount*8>ub->size) return false;
        *out=*(const uint64_t*)(ub->data+po+(midx-1)*8); return true;
    }
    return false;
}

__attribute__((visibility("hidden")))
inline bool get_field_off(const file_buffer_t *ub,const section_list_t *da,const section_list_t *ex,
                          uint64_t mrva,int ti,int fi,bool vt,int *out){
    if(!ub||!ub->data||!da||!ex||!out) return false;
    uint64_t mo=0; if(!va_to_off_any(da,ex,mrva,&mo)||mo+sizeof(Il2CppMetadataRegistration)>ub->size) return false;
    const Il2CppMetadataRegistration *mr=(const Il2CppMetadataRegistration*)(ub->data+mo);
    if(mr->fieldOffsetsCount<=0||!mr->fieldOffsets) return false;
    if(ti<0||ti>=mr->fieldOffsetsCount) return false;
    uint64_t fp=0; if(!va_to_off_any(da,ex,mr->fieldOffsets,&fp)) return false;
    if(fp+(uint64_t)mr->fieldOffsetsCount*8>ub->size) return false;
    uint64_t pva=*(const uint64_t*)(ub->data+fp+(uint64_t)ti*8); if(!pva) return false;
    uint64_t po=0; if(!va_to_off_any(da,ex,pva,&po)) return false;
    if(po+(uint64_t)(fi+1)*4>ub->size) return false;
    int32_t offset=*(const int32_t*)(ub->data+po+(uint64_t)fi*4);
    if(offset>0&&vt) offset-=16;
    *out=offset; return true;
}

// ─── Path finders ──────────────────────────────────────────────────────────────
struct _libinfo { char path[512]; bool found; };
__attribute__((visibility("hidden")))
static int _lib_cb(struct dl_phdr_info *info,size_t,void *d){
    _libinfo *li=(_libinfo*)d;
    if(info->dlpi_name&&strstr(info->dlpi_name,OBFUSCATE("libil2cpp.so"))){
        strncpy(li->path,info->dlpi_name,511);li->path[511]=0;li->found=true;return 1;
    }
    return 0;
}
__attribute__((visibility("hidden")))
inline char *find_libil2cpp_path(){
    static char cache[512]={0}; if(cache[0]) return strdup(cache);
    _libinfo li={0}; dl_iterate_phdr(_lib_cb,&li);
    if(li.found&&li.path[0]){strncpy(cache,li.path,511);return strdup(li.path);}
    FILE *maps=fopen(OBFUSCATE("/proc/self/maps"),"r");
    if(maps){char ln[1024];
        while(fgets(ln,sizeof(ln),maps)){
            if(strstr(ln,OBFUSCATE("libil2cpp.so"))){
                char *p=strstr(ln,"/");if(p){char *e=strchr(p,'\n');if(e)*e=0;strncpy(cache,p,511);fclose(maps);return strdup(cache);}
            }
        }
        fclose(maps);
    }
    return NULL;
}
__attribute__((visibility("hidden")))
inline char *find_metadata_path(){
    static char cache[512]={0}; if(cache[0]) return strdup(cache);
    const char *kp[]={
        "/storage/emulated/0/Android/data/com.garena.game.kgvn/files/il2cpp/Metadata/global-metadata.dat",
        "/storage/emulated/0/Android/data/com.garena.game.kgtw/files/il2cpp/Metadata/global-metadata.dat",
        NULL
    };
    for(int i=0;kp[i];i++) if(access(kp[i],R_OK)==0){strncpy(cache,kp[i],511);return strdup(cache);}
    char *lp=find_libil2cpp_path();
    if(lp){char *sep=strstr(lp,OBFUSCATE("/libil2cpp.so"));
        if(sep){*sep=0;char *sl=strrchr(lp,'/');if(sl){*sl=0;
            char rp[512];snprintf(rp,sizeof(rp),"%s/Managed/Metadata/global-metadata.dat",lp);
            if(access(rp,R_OK)==0){strncpy(cache,rp,511);free(lp);return strdup(cache);}
        }}
        free(lp);
    }
    char pkg[256]={0};
    FILE *cl=fopen(OBFUSCATE("/proc/self/cmdline"),"r");
    if(cl){if(fgets(pkg,sizeof(pkg),cl)){for(size_t i=0;i<sizeof(pkg);i++){if(!pkg[i]||pkg[i]==':'){pkg[i]=0;break;}}}fclose(cl);}
    if(pkg[0]){
        char tp[512];
        snprintf(tp,sizeof(tp),"/storage/emulated/0/Android/data/%s/files/il2cpp/Metadata/global-metadata.dat",pkg);
        if(access(tp,R_OK)==0){strncpy(cache,tp,511);return strdup(cache);}
        // Fallback paths
        const char *fps[]=
        {"/data/data/%s/files/global-metadata.dat","/sdcard/Android/data/%s/files/global-metadata.dat",NULL};
        for(int i=0;fps[i];i++){snprintf(tp,sizeof(tp),fps[i],pkg);if(access(tp,R_OK)==0){strncpy(cache,tp,511);return strdup(cache);}}
    }
    const char *dp[]={"/data/local/tmp/global-metadata.dat","/sdcard/global-metadata.dat",NULL};
    for(int i=0;dp[i];i++) if(access(dp[i],R_OK)==0){strncpy(cache,dp[i],511);return strdup(cache);}
    return NULL;
}

// ─── Cache ─────────────────────────────────────────────────────────────────────
__attribute__((visibility("hidden")))
inline bool init_cache(unity_cache_t *c){
    if(!c) return false; memset(c,0,sizeof(*c));
    char *lp=find_libil2cpp_path(),*mp=find_metadata_path();
    if(!lp||!mp){free(lp);free(mp);return false;}
    if(!read_file(mp,&c->meta)){free(lp);free(mp);return false;}
    free(lp);free(mp);
    if(!_load_mem(&c->unity,&c->exec_secs,&c->data_secs,&c->image_base)){free_file(&c->meta);return false;}
    deobf_meta(&c->meta);
    if(c->meta.size<0x100){free_file(&c->meta);return false;}
    c->hdr=(const uint32_t*)c->meta.data;
    if(c->hdr[0]!=0xFAB11BAFu||c->hdr[1]<29){free_file(&c->meta);return false;}
    if((uint64_t)c->hdr[42]+(uint64_t)c->hdr[43]>c->meta.size||
       (uint64_t)c->hdr[40]+(uint64_t)c->hdr[41]>c->meta.size||
       (uint64_t)c->hdr[12]+(uint64_t)c->hdr[13]>c->meta.size||
       (uint64_t)c->hdr[24]+(uint64_t)c->hdr[25]>c->meta.size||
       (uint64_t)c->hdr[6] +(uint64_t)c->hdr[7] >c->meta.size){free_file(&c->meta);return false;}
    int ic=c->hdr[43]/(int)sizeof(Il2CppImageDefinition);
    if(!find_code_reg(&c->unity,&c->exec_secs,&c->data_secs,ic,&c->meta,c->hdr,&c->code_reg_va)){free_file(&c->meta);return false;}
    int tdc=c->hdr[41]/(int)sizeof(Il2CppTypeDefinition);
    if(!find_meta_reg(&c->unity,&c->exec_secs,&c->data_secs,tdc,&c->meta_reg_va)){free_file(&c->meta);return false;}
    return true;
}
__attribute__((visibility("hidden")))
inline void free_cache(unity_cache_t *c){
    if(!c) return; sec_free(&c->exec_secs);sec_free(&c->data_secs);free_file(&c->meta);memset(c,0,sizeof(*c));
}

inline unity_cache_t   *g_unity_cache  = NULL;
inline pthread_mutex_t  g_cache_mutex  = PTHREAD_MUTEX_INITIALIZER;

__attribute__((visibility("hidden")))
inline unity_cache_t *get_cached_unity(){
    pthread_mutex_lock(&g_cache_mutex);
    if(g_unity_cache){pthread_mutex_unlock(&g_cache_mutex);return g_unity_cache;}
    unity_cache_t *tmp=(unity_cache_t*)malloc(sizeof(unity_cache_t));
    if(tmp){if(init_cache(tmp)){g_unity_cache=tmp;pthread_mutex_unlock(&g_cache_mutex);return g_unity_cache;}free(tmp);}
    pthread_mutex_unlock(&g_cache_mutex); return NULL;
}

inline bool EnsureCache(){ return get_cached_unity()!=NULL; }

inline uint64_t FindMethodOffset(const char *img,const char *ns,const char *type,const char *method,int argc){
    unity_cache_t *c=get_cached_unity(); if(!c) return 0;
    uint32_t tok=0;
    if(!find_method_tok(&c->meta,c->hdr,img,ns,type,method,argc,&tok)) return 0;
    uint64_t va=0;
    if(!get_method_ptr(&c->unity,&c->data_secs,&c->exec_secs,c->code_reg_va,img,tok,&va)) return 0;
    return (c->image_base>0)?(va-c->image_base):va;
}
inline int FindFieldOffset(const char *img,const char *ns,const char *type,const char *field){
    unity_cache_t *c=get_cached_unity(); if(!c) return 0;
    int ti=-1,fi=-1; bool vt=false;
    if(!find_field_idx(&c->meta,c->hdr,img,ns,type,field,&ti,&fi,&vt)) return 0;
    int off=0;
    if(!get_field_off(&c->unity,&c->data_secs,&c->exec_secs,c->meta_reg_va,ti,fi,vt,&off)) return 0;
    return off;
}
inline void *GetMethodAddress(uintptr_t base,const char *img,const char *ns,const char *type,const char *method,int argc){
    uint64_t rva=FindMethodOffset(img,ns,type,method,argc);
    if(!rva) return nullptr;
    return (void*)(base+(uintptr_t)rva);
}
inline uintptr_t GetFieldOffset(const char *img,const char *ns,const char *type,const char *field){
    return (uintptr_t)FindFieldOffset(img,ns,type,field);
}

} // namespace Unity

// ═══════════════════════════════════════════════════════════════════════════════
//  IL2Cpp implementations  (must come after namespace Unity)
// ═══════════════════════════════════════════════════════════════════════════════

void IL2Cpp::Il2CppAttach() {
    _guard::_halt_if_compromised();
    Unity::EnsureCache();
    void *h = nullptr;
    while (!h) { h = dlopen(targetLib, RTLD_LAZY); sleep(1); }
    il2cpp_domain_get_assemblies      = (void**(*)(const void*,size_t*))          dlsym(h,OBFUSCATE("il2cpp_domain_get_assemblies"));
    il2cpp_string_new                 = (Il2CppString*(*)(const char*))            dlsym(h,OBFUSCATE("il2cpp_string_new"));
    il2cpp_string_new_utf16           = (Il2CppString*(*)(const wchar_t*,int32_t)) dlsym(h,OBFUSCATE("il2cpp_string_new_utf16"));
    il2cpp_domain_get                 = (void*(*)())                               dlsym(h,OBFUSCATE("il2cpp_domain_get"));
    il2cpp_assembly_get_image         = (const void*(*)(const void*))              dlsym(h,OBFUSCATE("il2cpp_assembly_get_image"));
    il2cpp_image_get_name             = (const char*(*)(void*))                    dlsym(h,OBFUSCATE("il2cpp_image_get_name"));
    il2cpp_class_from_name            = (void*(*)(const void*,const char*,const char*)) dlsym(h,OBFUSCATE("il2cpp_class_from_name"));
    il2cpp_class_get_field_from_name  = (void*(*)(void*,const char*))              dlsym(h,OBFUSCATE("il2cpp_class_get_field_from_name"));
    il2cpp_field_static_get_value     = (void(*)(void*,void*))                     dlsym(h,OBFUSCATE("il2cpp_field_static_get_value"));
    il2cpp_field_static_set_value     = (void(*)(void*,void*))                     dlsym(h,OBFUSCATE("il2cpp_field_static_set_value"));
    il2cpp_class_get_method_from_name = (void*(*)(void*,const char*,int))          dlsym(h,OBFUSCATE("il2cpp_class_get_method_from_name"));
    il2cpp_field_get_offset           = (size_t(*)(void*))                         dlsym(h,OBFUSCATE("il2cpp_field_get_offset"));
    dlclose(h);
}

void *IL2Cpp::Il2CppGetMethodOffset(const char *image,const char *ns,const char *clazz,const char *name,int argc){
    uint64_t off=Unity::FindMethodOffset(image,ns,clazz,name,argc);
    if(off){ auto *c=Unity::get_cached_unity(); if(c&&c->image_base) return (void*)(c->image_base+off); }
    void *klass=Il2CppGetClassType(image,ns,clazz); if(!klass) return nullptr;
    void **method=(void**)il2cpp_class_get_method_from_name(klass,name,argc);
    return method?*method:nullptr;
}





size_t IL2Cpp::Il2CppGetFieldOffset(const char * const image, const char * const namespaze, const char * const clazz, const char * const name) {

    int offset = Unity::FindFieldOffset(image, namespaze, clazz, name);
    if (offset != 0) {

        return (size_t)offset;
    }
    auto * const img = IL2Cpp::Il2CppGetImageByName(image);
    if (!img) {

        return (size_t)-1;
    }
    auto * const klass = IL2Cpp::Il2CppGetClassType(image, namespaze, clazz);
    if (!klass) {

        return (size_t)-1;
    }
    auto * const field = il2cpp_class_get_field_from_name(klass, name);
    if (!field) {

        return (size_t)-1;
    }
    const auto result = il2cpp_field_get_offset(field);
    if (result == (size_t)-1) {

        return (size_t)-1;
    }

    return result;
}
