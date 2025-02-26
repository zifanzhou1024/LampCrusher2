export const gl = document.getElementById( "gl_canvas" ).getContext( "webgl" );

export class GpuDevice
{
  constructor()
  {
  }
}

export class GpuMesh
{
  constructor(vertices, indices)
  {
    this.vertices      = vertices;
    this.indices       = indices;
    this.vertex_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertex_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const stride = (3 + 3 + 2) * Float32Array.BYTES_PER_ELEMENT;

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);

    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, (3 + 3) * Float32Array.BYTES_PER_ELEMENT);

    this.index_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.index_buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  }

  draw()
  {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.index_buffer);
    gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_SHORT, 0);
  }
}

export class GpuVertexShader
{
  constructor(src)
  {
    this.shader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(this.shader, src);
    gl.compileShader(this.shader);
    if (!gl.getShaderParameter(this.shader, gl.COMPILE_STATUS))
    {
      const err = gl.getShaderInfoLog(this.shader);
      alert("Failed to compile shader!");
      console.trace();
      console.error(err);
      console.error(src);
    }
  }
}

export class GpuFragmentShader
{
  constructor(src)
  {
    this.shader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(this.shader, src);
    gl.compileShader(this.shader);
    if (!gl.getShaderParameter(this.shader, gl.COMPILE_STATUS))
    {
      const err = gl.getShaderInfoLog(this.shader);
      alert("Failed to compile shader!");
      console.trace();
      console.error(err);
      console.error(src);
    }
  }
}

export class GpuGraphicsPSO
{
  constructor(vertex_shader, fragment_shader, uniforms)
  {
    this.vertex_shader   = vertex_shader;
    this.fragment_shader = fragment_shader;
    this.pso             = gl.createProgram();
    this.uniforms        = uniforms;
    gl.attachShader(this.pso, this.vertex_shader.shader);
    gl.attachShader(this.pso, this.fragment_shader.shader);
    gl.linkProgram(this.pso);

    if (!gl.getProgramParameter(this.pso, gl.LINK_STATUS))
    {
      alert("Failed to link PSO!");
    }
  }

  bind(uniforms)
  {
    gl.useProgram(this.pso);
    this.texture_slots = 0;
    for (const name in this.uniforms)
    {
      if (obj[name])
      {
        this.set_uniform(name, obj[name]);
      }
    }

    for (const name in uniforms)
    {
      if (obj[name])
      {
        this.set_uniform(name, obj[name]);
      }
    }
  }

  set_uniform(name, value)
  {
    const location = this.gl.getUniformLocation(this.pso, name);

    if (!location)
    {
      console.error(`Uniform ${name} not found`);
      return;
    }

    if (Array.isArray(value))
    {
      if (value.length === 1)
      {
        gl.uniform1f(location, value[0]);
      }
      else if (value.length === 2)
      {
        gl.uniform2fv(location, value);
      }
      else if (value.length === 3)
      {
        gl.uniform3fv(location, value);
      }
      else if (value.length === 4)
      {
        gl.uniform4fv(location, value);
      }
      else if (value.length === 9)
      {
        gl.uniformMatrix3fv(location, false, value);
      }
      else if (value.length === 16)
      {
        gl.uniformMatrix4fv(location, false, value);
      }
    }
    else if (value instanceof WebGLTexture)
    {
      this.gl.activeTexture(this.gl.TEXTURE0 + this.texture_slots);
      this.gl.bindTexture(this.gl.TEXTURE_2D, value);
      this.gl.uniform1i(location, this.texture_slots);
      this.texture_slots++;
    }
    else
    {
      gl.uniform1f(location, value);
    }
  }
}

