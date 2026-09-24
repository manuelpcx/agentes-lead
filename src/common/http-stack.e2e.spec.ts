import {
  Body,
  Controller,
  INestApplication,
  Module,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';

/**
 * Prueba de humo del stack HTTP real (express + body-parser + multer) tal
 * como lo levanta `main.ts`: `rawBody: true` y `FileInterceptor`. Existe
 * porque esas dos librerías se fijan por `overrides` en pnpm-workspace.yaml
 * (parches de seguridad) y los tests unitarios no pasan por ellas: si una
 * versión nueva rompiera la subida de archivos o el cuerpo crudo de los
 * webhooks, se vería aquí y no en producción.
 */

interface UploadedProbeFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

@Controller('probe')
class ProbeController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 64 } }))
  upload(@UploadedFile() file?: UploadedProbeFile) {
    return {
      name: file?.originalname ?? null,
      size: file?.size ?? 0,
      text: file?.buffer.toString('utf8') ?? '',
    };
  }

  @Post('json')
  json(@Body() body: unknown, @Req() req: { rawBody?: Buffer }) {
    return { body, raw: req.rawBody?.toString('utf8') ?? null };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('stack HTTP (express + body-parser + multer)', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    app = await NestFactory.create(ProbeModule, {
      rawBody: true,
      logger: false,
    });
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('entrega el archivo subido como buffer en memoria (multer)', async () => {
    const text = 'nombre,telefono\nAna,+56911111111';
    const form = new FormData();
    form.append('file', new Blob([text]), 'x.csv');
    const res = await fetch(`${base}/probe/upload`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      name: 'x.csv',
      size: Buffer.byteLength(text),
      text,
    });
  });

  it('rechaza un archivo que supera el límite (413)', async () => {
    const form = new FormData();
    form.append('file', new Blob(['x'.repeat(200)]), 'grande.csv');
    const res = await fetch(`${base}/probe/upload`, {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(413);
  });

  it('parsea el JSON y conserva el cuerpo crudo para las firmas HMAC (body-parser)', async () => {
    const raw = '{"externalId":"lead-1","name":"Ana"}';
    const res = await fetch(`${base}/probe/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      body: { externalId: 'lead-1', name: 'Ana' },
      raw,
    });
  });
});
