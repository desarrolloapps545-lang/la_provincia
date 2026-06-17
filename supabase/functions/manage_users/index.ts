import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Manejo de Preflight (CORS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Inicialización del cliente administrativo de Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Extracción y limpieza del Token de Autorización
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error("Acceso no autorizado: Falta encabezado de autorización")
    
    // Ingeniería de Backend: Extracción robusta del JWT usando regex para ignorar Case-Sensitivity
    const token = authHeader.replace(/^Bearer\s/i, '')
    
    // Validación de identidad: Verificamos que el token pertenezca a un usuario válido
    const { data: { user: requester }, error: authError } = await supabaseAdmin.auth.getUser(token)
    
    if (authError || !requester) {
      console.error("Error de validación de Auth:", authError)
      throw new Error("Acceso no autorizado: Token inválido o sesión expirada")
    }

    const { action, userData } = await req.json()

    // --- LÓGICA DE ACCIONES ---

    // 1. CREAR USUARIO (Auth + Tabla Users)
    if (action === 'createUser') {
      // Validación de integridad: Rol Usuario requiere granja obligatoriamente
      if (userData.role === 'Usuario' && (!userData.farm || userData.farm === '' || userData.farm === 'Todas las granjas')) {
        throw new Error("Es obligatorio asignar una granja válida para usuarios con el rol 'Usuario'")
      }

      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: userData.email,
        password: userData.password,
        email_confirm: true
      })
      if (createError) throw createError

      const { error: dbError } = await supabaseAdmin
        .from('users')
        .insert([{
          id: newUser.user.id,
          name: userData.name,
          email: userData.email,
          farm: userData.farm,
          role: userData.role,
          cedula: userData.cedula,
          created_at: new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()).replace(' ', 'T').slice(0, 19).replace('T', ' ')
        }])
      if (dbError) throw dbError

      return new Response(JSON.stringify({ success: true, message: "Usuario creado exitosamente" }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }

    // 2. ACTUALIZAR CONTRASEÑA (Requester)
    if (action === 'updatePassword') {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(requester.id, {
        password: userData.password
      })
      if (error) throw error
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 3. ACTUALIZAR DATOS DE PERFIL (Requester)
    if (action === 'updateData') {
      const { data, error } = await supabaseAdmin
        .from('users')
        .update({
          name: userData.name,
          cedula: userData.cedula,
          farm: userData.farm
        })
        .eq('id', requester.id)
        .select()

      if (error) throw error
      if (!data || data.length === 0) throw new Error("No se encontró el perfil en la base de datos para actualizar")
      
      return new Response(JSON.stringify({ success: true, data: data[0] }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }

    // 4. LISTAR TODOS LOS USUARIOS (Acceso Administrativo)
    if (action === 'listUsers') {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('name, email, farm, role, cedula')
        .order('name', { ascending: true })
      
      if (error) throw error
      return new Response(JSON.stringify(data), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }

    throw new Error(`Acción '${action}' no implementada`)

  } catch (err) {
    const isAuthError = err.message.includes("autorizado") || err.message.includes("Token")
    return new Response(JSON.stringify({ error: err.message }), { 
      status: isAuthError ? 401 : 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }
})