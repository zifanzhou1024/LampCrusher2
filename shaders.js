export const kShaders = {
  'VS_ModelStdBasic': `
    precision highp float;
    varying vec3 f_Normal;
    varying vec2 f_UV;
    varying vec4 f_NDCPos;
    varying vec4 f_PrevNDCPos;

    attribute vec3 position;
    attribute vec3 normal;
    attribute vec2 uv;

    uniform mat4 g_Model;
    uniform mat4 g_ViewProj;

    uniform mat4 g_PrevModel;
    uniform mat4 g_PrevViewProj;

    uniform vec3 g_TAAJitter;
        
    void main()
    {
      vec4 ws_pos      = g_Model    * vec4( position, 1.0 );
      vec4 ndc_pos     = g_ViewProj * ws_pos;

      vec4 prev_ws_pos = g_PrevModel    * vec4( position, 1.0 );
      vec4 prev_ndc    = g_PrevViewProj * prev_ws_pos;

      vec3 normal_scale = vec3(
        dot(g_Model[0].xyz, g_Model[0].xyz),
        dot(g_Model[1].xyz, g_Model[1].xyz),
        dot(g_Model[2].xyz, g_Model[2].xyz)
      );

      f_NDCPos         = ndc_pos;
      f_PrevNDCPos     = prev_ndc;
      f_Normal         = normalize( mat3( g_Model ) * ( normal / normal_scale ) );
      f_UV             = uv;

      gl_Position      = ndc_pos + vec4( g_TAAJitter.xy * ndc_pos.w, 0.0, 0.0 );
    } `,

  'VS_ModelSkinned': `
    precision highp float;
    varying vec3 f_Normal;
    varying vec2 f_UV;
    varying vec4 f_NDCPos;
    varying vec4 f_PrevNDCPos;

    attribute vec3 position;
    attribute vec3 normal;
    attribute vec2 uv;
    attribute vec2 bone_weights;
    attribute vec2 bone_indices;

    uniform mat4 g_Model;

    uniform mat4 g_BoneMatrices[4];
    uniform mat4 g_ViewProj;

    uniform mat4 g_PrevBoneMatrices[4];
    uniform mat4 g_PrevViewProj;

    uniform vec3 g_TAAJitter;
        
    void main()
    {
      vec4 model_pos        = g_Model * vec4( position, 1.0 );

      mat4 skin_matrix      = g_BoneMatrices[int(bone_indices.x)] * bone_weights.x +
                              g_BoneMatrices[int(bone_indices.y)] * bone_weights.y;

      vec4 ws_pos           = skin_matrix * model_pos;

      mat4 prev_skin_matrix = g_PrevBoneMatrices[int(bone_indices.x)] * bone_weights.x +
                              g_PrevBoneMatrices[int(bone_indices.y)] * bone_weights.y;
      vec4 prev_ws_pos      = prev_skin_matrix * model_pos;

      vec4 ndc_pos          = g_ViewProj * ws_pos;
      vec4 prev_ndc         = g_PrevViewProj * prev_ws_pos;

      vec3 normal_scale = vec3(
        dot(g_Model[0].xyz, g_Model[0].xyz),
        dot(g_Model[1].xyz, g_Model[1].xyz),
        dot(g_Model[2].xyz, g_Model[2].xyz)
      );

      f_NDCPos              = ndc_pos;
      f_PrevNDCPos          = prev_ndc;
      f_Normal              = normalize( mat3( skin_matrix ) * ( mat3( g_Model ) * ( normal / normal_scale ) ) );
      f_UV                  = uv;

      gl_Position           = ndc_pos + vec4( g_TAAJitter.xy * ndc_pos.w, 0.0, 0.0 );
    } `,

  'PS_PBRMaterial': `
    #extension GL_EXT_draw_buffers : require
    precision highp float;

    varying vec3  f_Normal;
    varying vec2  f_UV;
    varying vec4  f_NDCPos;
    varying vec4  f_PrevNDCPos;

    uniform vec3  g_Diffuse;
    uniform float g_Roughness;
    uniform float g_Metallic;

    vec2 calculate_velocity(vec4 old_pos, vec4 new_pos)
    {
      old_pos   /= old_pos.w;
      old_pos.xy = (old_pos.xy + vec2(1.0, 1.0)) / 2.0;
      old_pos.y  = 1.0 - old_pos.y;

      new_pos   /= new_pos.w;
      new_pos.xy = (new_pos.xy + vec2(1.0, 1.0)) / 2.0;
      new_pos.y  = 1.0 - new_pos.y;

      vec2 velocity = (new_pos - old_pos).xy;
      velocity.x   *= -1.0;
      return velocity;
    }

    void main()
    {                                                           
      // TODO(bshihabi): We'll add texture mapping soon.
      vec3  diffuse    = g_Diffuse;
      vec3  normal     = normalize( f_Normal );
      float roughness  = g_Roughness;
      float metallic   = g_Metallic;

      vec2  velocity   = calculate_velocity( f_PrevNDCPos, f_NDCPos );

      gl_FragData[ 0 ] = vec4( diffuse, metallic );
      gl_FragData[ 1 ] = vec4( f_Normal, roughness );
      gl_FragData[ 2 ] = vec4( velocity, 0.0, 0.0 );
    }`,

  'VS_FullscreenQuad': `
    precision mediump float;
    
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec2 uv;

    varying vec2 f_UV;
        
    void main()
    {                                                                   
      gl_Position = vec4( position.xy, 0.0, 1.0 );
      f_UV        = uv;
    }`,

  'PS_Blit': `
    precision mediump float;

    uniform sampler2D g_Sampler;

    varying vec2 f_UV;

    void main()
    {
      gl_FragColor = vec4( texture2D( g_Sampler, f_UV ).rgb, 1.0 );
    }`,

  'PS_StandardBrdf': `
      precision mediump float;

      uniform sampler2D g_DiffuseMetallic;
      uniform sampler2D g_NormalRoughness;
      uniform sampler2D g_Depth;
      uniform sampler2D g_ShadowMapDirectional;

      uniform mat4      g_InverseViewProj;
      uniform vec3      g_DirectionalLightDirection;
      uniform vec3      g_DirectionalLightChromaticity;
      uniform float     g_DirectionalLightLuminance;

      uniform vec3      g_SpotLightDirection;
      uniform vec3      g_SpotLightPosition;
      uniform vec3      g_SpotLightChromaticity;
      uniform float     g_SpotLightLuminance;
      uniform float     g_SpotLightInnerCutoff;
      uniform float     g_SpotLightOuterCutoff;

      uniform mat4      g_DirectionalLightViewProj;

      uniform vec3      g_WSCameraPosition;
      uniform vec3      g_SkyColor;

      uniform bool      g_EnablePCF;

      varying vec2      f_UV;
      
      const float kPI  = 3.1415926535897932;

      // NOTE(bshihabi): A lot of this lighting shader is taken from my own personal renderer
      // Mostly translated from HLSL to GLSL
      float distribution_ggx( float NdotH, float roughness )
      {
        float a      = roughness * roughness;
        float a2     = a * a;
        float NdotH2 = NdotH * NdotH;

        float nom    = a2;
        float denom  = ( NdotH2 * ( a2 - 1.0 ) + 1.0 );
        denom        = kPI * denom * denom;

        return nom / max( denom, 0.0000001 );
      }

      float geometry_schlick_ggx( float NdotV, float roughness )
      {
        float r    = ( roughness + 1.0 );
        float k    = ( r * r ) / 8.0;

        float nom   = NdotV;
        float denom = NdotV * ( 1.0 - k ) + k;

        return nom / denom;
      }

      float geometry_smith( float NdotV, float NdotL, float roughness )
      {
        float ggx2  = geometry_schlick_ggx( NdotV, roughness );
        float ggx1  = geometry_schlick_ggx( NdotL, roughness );

        return ggx1 * ggx2;
      }

      vec3 fresnel_schlick( float HdotV, vec3 f0 )
      {
        return f0 + ( vec3( 1.0, 1.0, 1.0 ) - f0 ) * pow( max( 1.0 - HdotV, 0.0 ), 5.0 );
      }

      // Rendering Equation: ∫ fᵣ(x,ωᵢ,ωₒ,λ,t) Lᵢ(x,ωᵢ,ωₒ,λ,t) (ωᵢ⋅n̂) dωᵢ

      vec3 evaluate_directional_radiance( vec3 light_diffuse, float light_intensity )
      {
        return light_diffuse * light_intensity;
      }

      vec3 evaluate_directional_light(
        vec3  light_direction,
        vec3  light_diffuse,
        float light_intensity,
        vec3  view_direction,
        vec3  normal,
        float roughness,
        float metallic,
        vec3  diffuse
      ) {
        light_direction = -normalize( light_direction );

        // The light direction from the fragment position
        vec3 halfway_vector  = normalize( view_direction + light_direction );

        // Add the radiance
        vec3 radiance        = light_diffuse * light_intensity;

        // Surface reflection at 0 incidence
        vec3   f0        = vec3( 0.04, 0.04, 0.04 );
        f0               = mix( f0, diffuse, metallic );

        float  NdotV     = max( dot( normal, view_direction ),         0.0 );
        float  NdotH     = max( dot( normal, halfway_vector ),         0.0 );
        float  HdotV     = max( dot( halfway_vector, view_direction ), 0.0 );
        float  NdotL     = max( dot( normal, light_direction ),        0.0 );

        // Cook torrance BRDF
        float  D         = distribution_ggx( NdotH, roughness );
        float  G         = geometry_smith( NdotV, NdotL, roughness );
        vec3   F         = fresnel_schlick( HdotV, f0 );

        vec3   kS         = F;
        vec3   kD         = vec3( 1.0, 1.0, 1.0 ) - kS;
        kD               *= 1.0 - metallic;

        vec3  numerator   = D * G * F;
        float denominator = 4.0 * NdotV * NdotL;
        vec3  specular    = numerator / max( denominator, 0.001 );

        return ( ( kD * diffuse + specular ) * radiance * NdotL ) / kPI;
      }

      vec3 evaluate_spot_light(
        vec3  light_position,
        vec3  light_direction,
        vec3  light_diffuse,
        float light_intensity,
        float light_inner_cutoff,
        float light_outer_cutoff,
        vec3  ws_pos,
        vec3  view_direction,
        vec3  normal,
        float roughness,
        float metallic,
        vec3  diffuse
      ) {
        vec3 L               = normalize( light_position - ws_pos );

        // The light direction from the fragment position
        vec3 halfway_vector  = normalize( view_direction + L );

        // Attenuate by spotlight
        light_direction      = -normalize( light_direction );
        float theta          = dot( L, light_direction );
        float epsilon        = light_inner_cutoff - light_outer_cutoff;
        float spot_atten     = clamp( ( theta - light_outer_cutoff ) / epsilon, 0.0, 1.0 ) ;

        // Add the radiance
        vec3 radiance        = light_diffuse * light_intensity * spot_atten;

        // Surface reflection at 0 incidence
        vec3   f0        = vec3( 0.04, 0.04, 0.04 );
        f0               = mix( f0, diffuse, metallic );

        float  NdotV     = max( dot( normal, view_direction ),         0.0 );
        float  NdotH     = max( dot( normal, halfway_vector ),         0.0 );
        float  HdotV     = max( dot( halfway_vector, view_direction ), 0.0 );
        float  NdotL     = max( dot( normal, L ),                      0.0 );

        // Cook torrance BRDF
        float  D         = distribution_ggx( NdotH, roughness );
        float  G         = geometry_smith( NdotV, NdotL, roughness );
        vec3   F         = fresnel_schlick( HdotV, f0 );

        vec3   kS         = F;
        vec3   kD         = vec3( 1.0, 1.0, 1.0 ) - kS;
        kD               *= 1.0 - metallic;

        vec3  numerator   = D * G * F;
        float denominator = 4.0 * NdotV * NdotL;
        vec3  specular    = numerator / max( denominator, 0.001 );


        return ( ( kD * diffuse + specular ) * radiance * NdotL ) / kPI;
      }

      
      vec4 screen_to_world( vec2 uv, float depth )
      {
        uv.y                   = 1.0 - uv.y;
        vec2 normalized_screen = uv.xy * 2.0 - vec2( 1.0, 1.0 );
        normalized_screen.y   *= -1.0;

        vec4 clip              = vec4( normalized_screen, 2.0 * depth - 1.0, 1.0 );

        vec4 world             = g_InverseViewProj * clip;
        world                 /= world.w;

        return world;
      }

      float pcf_shadow( vec3 ws_pos )
      {
        vec4 dir_ls_pos  = g_DirectionalLightViewProj * vec4( ws_pos, 1.0 );
        dir_ls_pos.xyz  /= dir_ls_pos.w;
        float shadow     = 0.0;

        if ( dir_ls_pos.z <= 1.0 && dir_ls_pos.x >= -1.0 && dir_ls_pos.y >= -1.0 && dir_ls_pos.x <= 1.0 && dir_ls_pos.y <= 1.0 )
        {
          float kBias = 0.005;
          dir_ls_pos  = ( dir_ls_pos + 1.0 ) / 2.0;
          for ( int x = -1; x <= 1; x++ )
          {
            for ( int y = -1; y <= 1; y++ )
            {
              vec2  uv_offset     = vec2( x, y ) * ( 1.0 / 4096.0 );
              uv_offset          *= g_EnablePCF ? 1.0 : 0.0;
              float closest_depth = texture2D( g_ShadowMapDirectional, dir_ls_pos.xy + uv_offset ).x;
              shadow += dir_ls_pos.z > closest_depth + kBias ? 1.0 : 0.0; 
            }
          }
        }

        shadow /= 9.0;
        return shadow;
      }

      void main()
      {                                                           
        vec3  diffuse   = texture2D( g_DiffuseMetallic, f_UV ).rgb;
        float metallic  = texture2D( g_DiffuseMetallic, f_UV ).a;
        
        vec3  normal    = texture2D( g_NormalRoughness, f_UV ).rgb;
        float roughness = texture2D( g_NormalRoughness, f_UV ).a;

        float depth     = texture2D( g_Depth,           f_UV ).r;

        vec3  ws_pos      = screen_to_world( f_UV, depth ).xyz;
        vec3  view_dir    = normalize( g_WSCameraPosition.xyz - ws_pos );
        float shadow      = pcf_shadow( ws_pos );

        vec3 directional = evaluate_directional_light(
          g_DirectionalLightDirection,
          g_DirectionalLightChromaticity,
          g_DirectionalLightLuminance,
          view_dir,
          normal,
          roughness,
          metallic,
          diffuse
        );

        vec3 spot_light = evaluate_spot_light(
          g_SpotLightPosition,
          g_SpotLightDirection,
          g_SpotLightChromaticity,
          g_SpotLightLuminance,
          g_SpotLightInnerCutoff,
          g_SpotLightOuterCutoff,
          ws_pos,
          view_dir,
          normal,
          roughness,
          metallic,
          diffuse
        );

        vec3 irradiance = directional * max( 1.0 - shadow, 0.2 ) + spot_light;

        gl_FragColor    =  depth == 0.0 ? vec4( g_SkyColor, 1.0 ) : vec4( irradiance, 1.0 );
      }`,
  
  'PS_TAA': `
    precision mediump float;

    uniform sampler2D g_PBRBuffer;
    uniform sampler2D g_AccumulationBuffer;
    uniform sampler2D g_GBufferVelocity;
    uniform sampler2D g_GBufferVelocityPrev;

    uniform sampler2D g_GBufferDepth;

    uniform vec3      g_Dimensions;

    varying vec2 f_UV;

    vec2 texel_to_uv( vec2 texel )
    {
      vec2 dimensions = g_Dimensions.xy;
      // texel = clamp( texel, vec2( 0.0 ), dimensions );
      texel /= dimensions;
      texel.y = 1.0 - texel.y;

      return texel;
    }

    float luma_rec709( vec3 color )
    {
      return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
    }

    vec3 luma_weight_color_rec709( vec3 color )
    {
      return color / ( 1.0 + luma_rec709( color ) );
    }

    vec3 inverse_luma_weight_color_rec709( vec3 color )
    {
      return color / ( 1.0 - luma_rec709( color ) );
    }

    void tap_curr_buffer(
      vec2 texel_offset,
      vec2 texel,
      inout vec3 min_color,
      inout vec3 max_color
    ) {
      vec2 uv    = texel_to_uv( texel + texel_offset );
      vec3 color = luma_weight_color_rec709( texture2D( g_PBRBuffer, uv ).rgb );

      min_color  = min( min_color, color );
      max_color  = max( max_color, color );
    }

    vec2 get_dilated_texel( vec2 texel )
    {
      float closest_depth     = 0.0;
      vec2  closest_texel_pos = texel;

      for ( int y = -1; y <= 1; y++ )
      {
        for ( int x = -1; x <= 1; x++ )
        {
          vec2 pos                 = texel + vec2( x, y );
          float neighborhood_depth = texture2D( g_GBufferDepth, texel_to_uv( pos ) ).r;

          if ( neighborhood_depth > closest_depth )
          {
            closest_texel_pos = pos;
            closest_depth     = neighborhood_depth;
          }
        }
      }

      return closest_texel_pos;
    }


    void main()
    {                                                           
      vec2 thread_id     = vec2( f_UV.x, 1.0 - f_UV.y ) * g_Dimensions.xy;
      vec2 dilated_texel = get_dilated_texel( thread_id );

      vec3 min_color_cross = vec3(  9999.0 );
      vec3 max_color_cross = vec3( -9999.0 );

      tap_curr_buffer(vec2( 0, -1), thread_id, min_color_cross, max_color_cross);
      tap_curr_buffer(vec2(-1,  0), thread_id, min_color_cross, max_color_cross);
      tap_curr_buffer(vec2( 0,  0), thread_id, min_color_cross, max_color_cross);
      tap_curr_buffer(vec2( 1,  0), thread_id, min_color_cross, max_color_cross);
      tap_curr_buffer(vec2( 0,  1), thread_id, min_color_cross, max_color_cross);

      vec3 min_color_3x3   = min_color_cross;
      vec3 max_color_3x3   = max_color_cross;

      tap_curr_buffer(vec2(-1, -1), thread_id, min_color_3x3,   max_color_3x3);
      tap_curr_buffer(vec2( 1, -1), thread_id, min_color_3x3,   max_color_3x3);
      tap_curr_buffer(vec2(-1,  1), thread_id, min_color_3x3,   max_color_3x3);
      tap_curr_buffer(vec2( 1,  1), thread_id, min_color_3x3,   max_color_3x3);

      vec3 min_color = min_color_3x3 * 0.5 + min_color_cross * 0.5;
      vec3 max_color = max_color_3x3 * 0.5 + max_color_cross * 0.5;

      vec2 uv            = texel_to_uv( thread_id );
      vec2 curr_velocity = texture2D( g_GBufferVelocity, uv ).xy;

      vec2 reproj_uv     = uv + curr_velocity;
      vec2 prev_velocity = texture2D( g_GBufferVelocityPrev, reproj_uv ).xy;

      float acceleration          = length( prev_velocity - curr_velocity );
      float velocity_disocclusion = clamp( ( acceleration - 0.001 ) * 10.0, 0.0, 1.0 );

      vec3 curr_color    = luma_weight_color_rec709( texture2D( g_PBRBuffer,     uv ).rgb );
      vec3 prev_color    = luma_weight_color_rec709( texture2D( g_AccumulationBuffer, reproj_uv ).rgb );
      prev_color         = clamp( prev_color, min_color, max_color );
      vec3 accumulation  = 0.9 * prev_color + 0.1 * curr_color;
        
      vec3 resolve       = mix( accumulation, curr_color, velocity_disocclusion );
      gl_FragColor       = vec4( inverse_luma_weight_color_rec709( resolve ), 1.0 );
    }`,

  'PS_Tonemapping': `
    precision mediump float;

    uniform sampler2D g_HDRBuffer;

    varying vec2 f_UV;

    // This is technically the worse approximation but I doubt you can tell
    // the difference.
    // https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/
    vec3 aces_film(vec3 x)
    {
      float a = 2.51;
      float b = 0.03;
      float c = 2.43;
      float d = 0.59;
      float e = 0.14;
      return clamp( ( x * ( a * x + b ) ) / ( x * ( c * x + d ) + e ), 0.0, 1.0 );
    }

    vec3 transfer_function_gamma( vec3 color )
    {
      return pow( color, vec3( 1.0 / 2.2 ) );
    }

    void main()
    {                                                           
      vec3 radiometry       = texture2D( g_HDRBuffer, f_UV ).rgb;

      vec3 tonemapped       = aces_film( radiometry );
      vec3 gamma_compressed = transfer_function_gamma( tonemapped );

      gl_FragColor = vec4( gamma_compressed, 1.0 );
    }`,

  'VS_Debug': `
    attribute vec3 position;
    uniform mat4 g_Model;
    uniform mat4 g_ViewProj;

    void main()
    {
      vec4 ws_pos  = g_Model    * vec4( position, 1.0 );
      vec4 ndc_pos = g_ViewProj * ws_pos;
      gl_Position  = ndc_pos;
    }
  `,

  'PS_Debug': `
    precision mediump float;

    uniform vec4 g_Color;

    void main()
    {
      gl_FragColor = g_Color;
    }
  `,

  'VS_DebugVertexColor': `
    attribute vec3 position;
    attribute vec3 color;

    uniform mat4 g_Model;
    uniform mat4 g_ViewProj;

    varying vec3 f_Color;

    void main()
    {
      vec4 ws_pos  = g_Model    * vec4( position, 1.0 );
      vec4 ndc_pos = g_ViewProj * ws_pos;

      f_Color      = color;
      gl_Position  = ndc_pos;
    }
  `,

  'PS_DebugVertexColor': `
    precision mediump float;

    varying vec3 f_Color;

    void main()
    {
      gl_FragColor = vec4( f_Color, 1.0 );
    }
  `,
  'PS_Smoke': `
precision mediump float;

uniform vec2 u_iResolution;
uniform float u_iTime;

uniform mat4 g_Model;     // Model transformation for localizing the smoke
uniform mat4 g_ModelInv;  // Precomputed inverse of g_Model


// New uniforms to pass camera info
uniform vec3 u_CamPos;
uniform mat4 u_InverseViewProj;
uniform mat4 u_ViewProj;



//
// Simple noise function (adapted from IQ’s noise)
//
float noise(vec3 x) {
    vec3 p = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    vec2 uv = (p.xy + vec2(37.0, 17.0) * p.z) + f.xy;
    return fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453) * 2.0 - 1.0;
}

//
// Smoke density function with fbm accumulation.
//
float smoke(vec3 p) {
    vec3 q = 1.2 * p;
    float f = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        q += u_iTime * vec3(0.17, -0.5, 0.0);
        f += a * noise(q);
        a *= 0.4;
        q *= 2.1;
    }
    float noiseShape = 0.5 + 0.7 * max(p.y, 0.0) - 0.15 * length(p.xz);
    return clamp(1.0 + noiseShape * f - length(p), 0.0, 1.0);
}

//
// A helper for raymarching the smoke volume.
//
vec3 shading(vec3 ro, vec3 rd) {
    vec3 ld = normalize(vec3(0.5, 1.0, -0.7));
    const int nbStep = 30;
    const float diam = 3.0;
    float rayLength = diam / float(nbStep);
    float start = length(ro) - diam / 2.0;
    float end = start + diam;
    float sumDen = 0.0;
    float sumDif = 0.0;
    
    
    
    for (int i = 0; i < nbStep; i++) {
        float d = end - float(i) * rayLength;
        if (d < start) break;
        vec3 p = ro + d * rd;
        if (dot(p, p) > diam * diam) break;
        float den = smoke(p);
        sumDen += den;
        if (den > 0.02) {
            sumDif += max(0.0, den - smoke(p + ld * 0.17));
        }
    }
    
    vec3 lightCol = vec3(0.95, 0.75, 0.3);
    float light = 10.0 * pow(max(0.0, dot(rd, ld)), 10.0);
    vec3 col = 0.01 * light * lightCol;
    col += 0.4 * sumDen * rayLength * vec3(0.8, 0.9, 1.0); // ambient term
    col += 1.3 * sumDif * rayLength * lightCol;             // diffuse term
    return col;
}

void main() {
    // Convert fragment coordinates to normalized device coordinates (NDC)
    vec2 ndc = (gl_FragCoord.xy / u_iResolution) * 2.0 - 1.0;
    ndc.y = -ndc.y; // adjust if needed (depending on your coordinate convention)
    
    // Reconstruct the world-space position for this fragment
    vec4 clipPos = vec4(ndc, 0.0, 1.0);
    vec4 worldPos = u_InverseViewProj * clipPos;
    worldPos /= worldPos.w;
    
    // Compute the world-space ray direction (from the camera position)
    vec3 rayDir = normalize(worldPos.xyz - u_CamPos);
    
    // Transform the camera position and ray direction into smoke’s local space
    vec3 localCamPos = (g_ModelInv * vec4(u_CamPos, 1.0)).xyz;
    vec3 localRd = normalize(mat3(g_ModelInv) * rayDir);
    
    vec3 col = shading(localCamPos, localRd);
    // Apply gamma correction.
    col = pow(col, vec3(1.0 / 2.2));
    gl_FragColor = vec4(col, 1.0);
}
`,
      'VS_Smoke': `
  precision mediump float;
  
  attribute vec3 position;
  attribute vec2 uv;
  uniform mat4 g_Model;       // Model transform for the smoke quad
  uniform mat4 u_ViewProj;    // View-projection transform
  varying vec2 f_LocalUV;     // Local coordinates for smoke
  
  void main() {
      // Transform the vertex into world space using g_Model.
      vec4 worldPos = g_Model * vec4(position, 1.0);
      
      // For a quad centered at the origin, assume its corners in local space are (-1,-1) to (1,1).
      // You can compute local UVs by dividing worldPos.xy by a chosen scale.
      // Here we assume the quad was designed so that after applying g_Model the x,y coordinates are in a useful range.
      // Alternatively, you can simply pass the attribute uv if that already represents local coordinates.
      f_LocalUV = uv;  // If your quad's uv are already set to [0,1]
      
      gl_Position = u_ViewProj * worldPos;
  }
`,

}
