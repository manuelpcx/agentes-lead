import { BadRequestException } from '@nestjs/common';
import { KnowledgeSourceType } from '@prisma/client';
import { PanelKnowledgeController } from './panel-knowledge.controller';
import { KnowledgeDocumentService } from './knowledge-document.service';

function build() {
  const documents = {
    create: jest
      .fn()
      .mockResolvedValue({ documentId: 'doc-1', version: 1, chunks: 2 }),
  } as unknown as KnowledgeDocumentService;
  return { controller: new PanelKnowledgeController(documents), documents };
}

describe('PanelKnowledgeController.upload', () => {
  it('lanza si no llega archivo', async () => {
    const { controller } = build();
    await expect(controller.upload(undefined)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('indexa el contenido del archivo con sourceType archivo', async () => {
    const { controller, documents } = build();

    const result = await controller.upload({
      originalname: 'politicas.txt',
      buffer: Buffer.from('Horario: 9 a 19'),
    });

    expect(documents.create).toHaveBeenCalledWith({
      title: 'politicas.txt',
      content: 'Horario: 9 a 19',
      sourceType: KnowledgeSourceType.archivo,
    });
    expect(result).toEqual({
      documentId: 'doc-1',
      version: 1,
      chunks: 2,
      title: 'politicas.txt',
    });
  });

  it('propaga el error de extractText para formatos no soportados', async () => {
    const { controller } = build();
    await expect(
      controller.upload({
        originalname: 'catalogo.pdf',
        buffer: Buffer.from('x'),
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
