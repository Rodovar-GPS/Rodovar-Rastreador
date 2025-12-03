<content><![CDATA[-- SCRIPT DE CONFIGURAÇÃO DO BANCO DE DADOS RODOVAR (SUPABASE)
-- Copie todo este conteúdo e rode no "SQL Editor" do Supabase.
-- 1. Criação da Tabela de Cargas (Shipments)
CREATE TABLE IF NOT EXISTS public.shipments (
code text PRIMARY KEY,
data jsonb NOT NULL,
created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
-- 2. Criação da Tabela de Motoristas (Drivers)
CREATE TABLE IF NOT EXISTS public.drivers (
id text PRIMARY KEY,
data jsonb NOT NULL,
created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
-- 3. Criação da Tabela de Usuários Admin (Users)
CREATE TABLE IF NOT EXISTS public.users (
username text PRIMARY KEY,
data jsonb NOT NULL,
created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
-- 4. Habilitar Segurança (RLS - Row Level Security)
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
-- 5. Remover políticas antigas para evitar erros ao rodar o script novamente
DROP POLICY IF EXISTS "Public Access Shipments" ON public.shipments;
DROP POLICY IF EXISTS "Public Access Drivers" ON public.drivers;
DROP POLICY IF EXISTS "Public Access Users" ON public.users;
-- 6. Criar Políticas de Acesso Público (Permite o App ler e escrever sem login de banco)
-- Nota: A segurança real é feita no código do App (Frontend), aqui liberamos a API.
CREATE POLICY "Public Access Shipments"
ON public.shipments
FOR ALL
USING (true)
WITH CHECK (true);
CREATE POLICY "Public Access Drivers"
ON public.drivers
FOR ALL
USING (true)
WITH CHECK (true);
CREATE POLICY "Public Access Users"
ON public.users
FOR ALL
USING (true)
WITH CHECK (true);
]]></content>
</change>
</changes>
