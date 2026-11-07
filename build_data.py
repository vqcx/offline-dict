#!/usr/bin/env python3
"""从 ECDICT 数据库生成词典前端用的 data/dict.js。

用法：
    python3 tools/build_data.py <stardict.db 路径>

ECDICT 下载地址（MIT 协议）：
    https://github.com/skywind3000/ECDICT
    https://github.com/skywind3000/ECDICT/releases      ← 推荐，下 ecdict-sqlite-28.zip
解压后得到 stardict.db，再运行本脚本。

输出格式：window.DICT_DATA = [[word, phonetic, pos, def_zh, def_en, forms, lvl], ...]
"""
import sqlite3
import json
import re
import os
import sys

POS_CN = {
    'n': '名词', 'v': '动词', 'a': '形容词', 'j': '形容词',
    's': '形容词', 'r': '副词', 'd': '副词', 'i': '介词',
    'p': '代词', 'c': '连词', 'u': '感叹词', 'm': '数词',
    't': '冠词', 'x': '不定式标记',
}

EXCHANGE_CN = {
    'p': '过去式', 'd': '过去分词', 'i': '现在分词',
    '3': '第三人称单数', 'r': '比较级', 't': '最高级',
    's': '复数',
}

# 筛选阈值：日常常用 + 文学古旧词
# frq  = 当代语料词频，bnc = 英国国家语料库词频（覆盖 19 世纪及以前文献）
MAX_FRQ = 20000
MAX_BNC = 15000


def clean(s):
    return '' if s is None else str(s).strip()


def pos_to_cn(pos):
    if not pos:
        return ''
    seen, out = set(), []
    for seg in str(pos).split('/'):
        m = re.match(r'^([A-Za-z]+)', seg.strip())
        if not m:
            continue
        code = m.group(1)
        label = POS_CN.get(code, code)
        if label not in seen:
            seen.add(label)
            out.append(label)
    return '、'.join(out)


def exchange_to_forms(ex):
    if not ex:
        return ''
    out = []
    for seg in str(ex).split('/'):
        if ':' not in seg:
            continue
        code, word = seg.split(':', 1)
        code, word = code.strip(), word.strip()
        if code in ('0', '1') or not word:
            continue
        out.append('%s：%s' % (EXCHANGE_CN.get(code, code), word))
    return '；'.join(out)


def main(db_path):
    if not os.path.exists(db_path):
        sys.exit('找不到数据库文件：%s' % db_path)

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute('''
        SELECT word, phonetic, definition, translation, pos, exchange,
               tag, collins, oxford, bnc, frq
        FROM stardict
        WHERE (
               (frq IS NOT NULL AND frq > 0 AND frq <= %d)
            OR (bnc IS NOT NULL AND bnc > 0 AND bnc <= %d)
            OR collins > 0 OR oxford > 0
            OR (tag IS NOT NULL AND tag != '')
        )
        AND word = lower(word)
        AND phonetic IS NOT NULL AND phonetic != ''
        AND translation IS NOT NULL AND translation != ''
    ''' % (MAX_FRQ, MAX_BNC))

    rows = []
    for (word, phonetic, definition, translation, pos,
         exchange, tag, collins, oxford, bnc, frq) in cur:
        w = (word or '').strip().lower()
        if not w:
            continue
        # 排除变形词（如 hens -> hen）
        if exchange and re.search(r'(^|/)0:', str(exchange)):
            continue
        zh = clean(translation)
        en = clean(definition)
        if not zh and not en:
            continue

        # 等级：2=考试大纲/核心词，1=高频常用，0=其他
        is_exam = bool(tag and str(tag).strip())
        is_core = (collins or 0) >= 2 or (oxford or 0) > 0
        is_freq = ((frq or 0) > 0 and frq <= 8000) or ((bnc or 0) > 0 and bnc <= 8000)
        lvl = 2 if (is_exam or is_core) else (1 if is_freq else 0)

        rows.append([
            w,
            clean(phonetic),
            pos_to_cn(pos),
            zh,
            en,
            exchange_to_forms(exchange),
            lvl,
        ])
    conn.close()

    rows.sort(key=lambda r: r[0])
    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, 'dict.js')

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('window.DICT_DATA=')
        json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')

    size_mb = os.path.getsize(out_path) / 1048576.0
    print('生成 %s' % out_path)
    print('  词条 %d 个，%.2f MB' % (len(rows), size_mb))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('用法：python3 tools/build_data.py <stardict.db 路径>')
    main(sys.argv[1])
