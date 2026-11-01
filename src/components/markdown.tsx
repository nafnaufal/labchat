import * as Clipboard from 'expo-clipboard';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Block =
  | { type: 'code'; lang: string; code: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'para'; text: string };

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]]+\]\([^)\s]+\))/g;

function isSpecialLine(line: string): boolean {
  return (
    /^```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^\s*[-*•]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^>\s?/.test(line)
  );
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const lang = fence[1] ?? '';
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence (may be missing while streaming)
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', text: quoteLines.join('\n') });
      continue;
    }
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !isSpecialLine(lines[i])) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'para', text: paraLines.join('\n') });
  }
  return blocks;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE_RE);
  const nodes: ReactNode[] = parts.map((part, index) => {
      const key = `${keyPrefix}-${index}`;
      if (!part) return null;
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        return (
          <Text key={key} style={{ fontWeight: '700' }}>
            {part.slice(2, -2)}
          </Text>
        );
      }
      if (/^\*[^*\n]+\*$/.test(part)) {
        return (
          <Text key={key} style={{ fontStyle: 'italic' }}>
            {part.slice(1, -1)}
          </Text>
        );
      }
      if (/^`[^`\n]+`$/.test(part)) {
        return (
          <InlineCode key={key}>{part.slice(1, -1)}</InlineCode>
        );
      }
      const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link) {
        return (
          <Text
            key={key}
            style={{ textDecorationLine: 'underline' }}
            onPress={() => {
              Linking.openURL(link[2]).catch(() => {});
            }}>
            {link[1]}
          </Text>
        );
      }
      return <Fragment key={key}>{part}</Fragment>;
    });
  return nodes.filter((node) => node !== null);
}

function InlineCode({ children }: { children: string }) {
  const colors = useTheme();
  return (
    <Text
      style={{
        fontFamily: Fonts.mono,
        fontSize: 13,
        color: colors.text,
        backgroundColor: colors.backgroundSelected,
      }}>
      {children}
    </Text>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const colors = useTheme();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View
      style={{
        backgroundColor: colors.backgroundElement,
        borderRadius: 12,
        borderCurve: 'continuous',
        marginVertical: 8,
      }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 12,
          paddingTop: 8,
        }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: Fonts.mono }}>
          {lang || 'code'}
        </Text>
        <Pressable onPress={copy} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name={copied ? 'check' : 'copy'} size={14} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
            {copied ? 'Tersalin' : 'Salin'}
          </Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text
          selectable
          style={{
            color: colors.text,
            fontFamily: Fonts.mono,
            fontSize: 13,
            lineHeight: 20,
            padding: 12,
            paddingTop: 6,
          }}>
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

/** Lightweight markdown renderer for chat messages (headings, lists, code, quotes, basic inline). */
export function Markdown({ text }: { text: string }) {
  const colors = useTheme();
  const blocks = useMemo(() => parseBlocks(text), [text]);

  return (
    <View style={{ gap: 4 }}>
      {blocks.map((block, index) => {
        const key = `block-${index}`;
        switch (block.type) {
          case 'code':
            return <CodeBlock key={key} code={block.code} lang={block.lang} />;
          case 'heading': {
            const fontSize = block.level === 1 ? 22 : block.level === 2 ? 19 : 16;
            return (
              <Text
                key={key}
                selectable
                style={{
                  color: colors.text,
                  fontSize,
                  fontWeight: '700',
                  lineHeight: fontSize * 1.35,
                  marginTop: index === 0 ? 0 : 6,
                }}>
                {renderInline(block.text, key)}
              </Text>
            );
          }
          case 'list':
            return (
              <View key={key} style={{ gap: 4, paddingLeft: 4 }}>
                {block.items.map((item, itemIndex) => (
                  <View key={`${key}-${itemIndex}`} style={{ flexDirection: 'row', gap: 8 }}>
                    <Text style={{ color: colors.textSecondary, fontSize: 16, lineHeight: 23 }}>
                      {block.ordered ? `${itemIndex + 1}.` : '•'}
                    </Text>
                    <Text selectable style={{ color: colors.text, fontSize: 16, lineHeight: 23, flex: 1 }}>
                      {renderInline(item, `${key}-${itemIndex}`)}
                    </Text>
                  </View>
                ))}
              </View>
            );
          case 'quote':
            return (
              <View
                key={key}
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: colors.border,
                  paddingLeft: 10,
                  marginVertical: 4,
                }}>
                <Text selectable style={{ color: colors.textSecondary, fontSize: 15, lineHeight: 22, fontStyle: 'italic' }}>
                  {renderInline(block.text, key)}
                </Text>
              </View>
            );
          default:
            return (
              <Text key={key} selectable style={{ color: colors.text, fontSize: 16, lineHeight: 23 }}>
                {renderInline(block.text, key)}
              </Text>
            );
        }
      })}
    </View>
  );
}
