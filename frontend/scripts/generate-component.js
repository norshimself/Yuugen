#!/usr/bin/env node

/**
 * NextJS Full-Stack Component Generator CLI
 * Implements the Enterprise NextJS Agent Skill for Yuugen Bot.
 * 
 * Usage: node generate-component.js <domain-singular> <domain-plural>
 * Example: node generate-component.js guild-settings guild-settings
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('\x1b[31mError: Please provide both singular and plural domain names.\x1b[0m');
  console.log('Usage: node generate-component.js <domain-singular> <domain-plural>');
  console.log('Example: node generate-component.js player players');
  process.exit(1);
}

const domainSingular = args[0].toLowerCase();
const domainPlural = args[1].toLowerCase();

// Helper transformations
const pascalSingular = toPascalCase(domainSingular);
const camelSingular = toCamelCase(domainSingular);
const kebabSingular = toKebabCase(domainSingular);

const pascalPlural = toPascalCase(domainPlural);
const camelPlural = toCamelCase(domainPlural);
const kebabPlural = toKebabCase(domainPlural);

// Base directory (assumes running from frontend root or scripts folder)
const projectRoot = findProjectRoot();
console.log(`\x1b[34mInitializing Generation at project root: ${projectRoot}\x1b[0m\n`);

// Helper to find project root by looking for package.json
function findProjectRoot() {
  let currentDir = process.cwd();
  while (currentDir !== path.parse(currentDir).root) {
    if (fs.existsSync(path.join(currentDir, 'package.json'))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  return process.cwd();
}

function toPascalCase(str) {
  return str
    .replace(/[-_]+/g, ' ')
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word) => word.toUpperCase())
    .replace(/\s+/g, '');
}

function toCamelCase(str) {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toKebabCase(str) {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function ensureDirExists(filePath) {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirExists(dirname);
  fs.mkdirSync(dirname);
}

function writeFile(filePath, content) {
  ensureDirExists(filePath);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`\x1b[32m[CREATED]\x1b[0m ${path.relative(projectRoot, filePath)}`);
}

// ----------------------------------------------------
// 1. Schema & Type Integration
// ----------------------------------------------------
const typeFilePath = path.join(projectRoot, 'types', `${kebabSingular}.ts`);
const typeContent = `// types/${kebabSingular}.ts
import { z } from 'zod';

export const ${pascalSingular}Schema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: z.string().min(3).max(100),
  createdAt: z.string().datetime(),
});

export type ${pascalSingular} = z.infer<typeof ${pascalSingular}Schema>;
export type Create${pascalSingular}Input = Omit<${pascalSingular}, 'id' | 'createdAt'>;
`;

// ----------------------------------------------------
// 2. Service Layer (API Client)
// ----------------------------------------------------
const serviceFilePath = path.join(projectRoot, 'services', `${kebabSingular}.service.ts`);
const serviceContent = `// services/${kebabSingular}.service.ts
import { ${pascalSingular}, Create${pascalSingular}Input } from '@/types/${kebabSingular}';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || '';

export const ${camelSingular}Service = {
  async getAll(): Promise<${pascalSingular}[]> {
    const res = await fetch(\`\${API_URL}/${kebabPlural}\`, {
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
      next: { tags: ['${kebabPlural}'] }, // Next.js Cache Tags
    });
    if (!res.ok) throw new Error('Failed to fetch ${kebabPlural}');
    return res.json();
  },

  async create(data: Create${pascalSingular}Input): Promise<${pascalSingular}> {
    const res = await fetch(\`\${API_URL}/${kebabPlural}\`, {
      method: 'POST',
      headers: { 
        'x-api-key': API_KEY,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create resource');
    return res.json();
  }
};
`;

// ----------------------------------------------------
// 3. Server Component (Data Fetching View)
// ----------------------------------------------------
const pageFilePath = path.join(projectRoot, 'app', kebabPlural, 'page.tsx');
const pageContent = `// app/${kebabPlural}/page.tsx
import { ${camelSingular}Service } from '@/services/${kebabSingular}.service';
import { Create${pascalSingular}Form } from '@/components/${kebabSingular}/Create${pascalSingular}Form';

export default async function ${pascalSingular}Page() {
  const data = await ${camelSingular}Service.getAll().catch(() => []); // Direct, server-side secure fetch

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6 text-white bg-[#04080c] min-h-screen">
      <h1 className="text-2xl font-serif font-bold tracking-tight text-brand-secondary uppercase">Manage ${pascalSingular}</h1>
      
      <Create${pascalSingular}Form />

      <div className="divide-y divide-white/5 border border-brand-secondary/15 rounded-[1.5rem] bg-[#101c26]/40 backdrop-blur-xl overflow-hidden">
        {data.length === 0 ? (
          <p className="p-6 text-brand-secondary/50 text-sm font-light italic text-center">No items found.</p>
        ) : (
          data.map((item) => (
            <div key={item.id} className="p-4.5 flex justify-between items-center hover:bg-white/5 transition">
              <span className="font-medium text-white/90 text-sm">{item.name}</span>
              <span className="text-[10px] text-brand-secondary/40 font-mono tracking-wider">{item.id}</span>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
`;

// ----------------------------------------------------
// 4. Client Component (Interactive Form & Mutation)
// ----------------------------------------------------
const formFilePath = path.join(projectRoot, 'components', kebabSingular, `Create${pascalSingular}Form.tsx`);
const formContent = `'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { ${pascalSingular}Schema, Create${pascalSingular}Input } from '@/types/${kebabSingular}';
import { ${camelSingular}Service } from '@/services/${kebabSingular}.service';

const createSchema = ${pascalSingular}Schema.pick({ ownerId: true, name: true });

export function Create${pascalSingular}Form() {
  const router = useRouter();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Create${pascalSingular}Input>({
    resolver: zodResolver(createSchema),
  });

  const onSubmit = async (data: Create${pascalSingular}Input) => {
    try {
      await ${camelSingular}Service.create(data);
      reset();
      router.refresh(); // Tells Next.js to re-fetch the Server Component data in the background
    } catch (err) {
      console.error('Failed to submit form:', err);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 bg-[#101c26]/40 p-6 rounded-[1.5rem] border border-brand-secondary/15 backdrop-blur-xl">
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] uppercase tracking-widest font-semibold text-brand-secondary/80">Resource Name</label>
        <input 
          {...register('name')} 
          placeholder="e.g. My Custom Resource" 
          className="w-full px-4 py-3 bg-[#04080c]/50 border border-brand-secondary/15 rounded-xl text-white font-sans text-sm focus:outline-none focus:border-brand-primary transition" 
        />
        {errors.name && <p className="text-red-400 text-xs mt-1 font-light">{errors.name.message}</p>}
      </div>
      <input type="hidden" {...register('ownerId')} value="b3b0a234-c011-4874-bc12-3211756285fa" />
      
      <button 
        type="submit" 
        disabled={isSubmitting} 
        className="w-full sm:w-auto px-6 py-3 bg-brand-primary text-white font-serif text-xs font-bold uppercase tracking-wider rounded-xl transition cursor-pointer hover:bg-brand-primary/80 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isSubmitting ? 'Adding...' : 'Add Resource'}
      </button>
    </form>
  );
}
`;

// Executing Writes
writeFile(typeFilePath, typeContent);
writeFile(serviceFilePath, serviceContent);
writeFile(pageFilePath, pageContent);
writeFile(formFilePath, formContent);

console.log('\n\x1b[32;1mNext.js Component Generation Complete!\x1b[0m');
console.log(`Generated type layer, service layer, page view, and client forms for "${domainSingular}".`);
