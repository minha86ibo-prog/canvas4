import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const geminiModel = "gemini-3-flash-preview";
export const imageModel = "imagen-4.0-generate-001";

export async function generateImageFromDescription(description: string, originalArtworkUrl: string) {
  try {
    // Using Imagen model as requested
    const response = await ai.models.generateImages({
      model: imageModel,
      prompt: `An artistic recreation based on this description: "${description}". The style should be inspired by the original artwork.`,
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/jpeg',
        aspectRatio: '1:1',
      },
    });

    const base64EncodeString = response.generatedImages[0].image.imageBytes;
    return `data:image/jpeg;base64,${base64EncodeString}`;
  } catch (error) {
    console.error("Error generating image with Imagen:", error);
    // Fallback to a high-quality placeholder for demo/prototype purposes
    const keywords = description.split(' ').slice(0, 3).join(',');
    return `https://picsum.photos/seed/${encodeURIComponent(description)}/1024/1024`;
  }
}

export async function getAIFeedback(description: string, originalArtworkUrl: string) {
  try {
    const response = await ai.models.generateContent({
      model: geminiModel,
      contents: {
        parts: [
          { text: `Compare this student's description: "${description}" with the original artwork. Provide constructive feedback on how they can observe and describe the artwork more deeply and accurately. Keep it encouraging and educational for a student. Response should be in Korean.` },
          { inlineData: { data: await fetchImageAsBase64(originalArtworkUrl), mimeType: "image/jpeg" } }
        ]
      }
    });
    return response.text;
  } catch (error) {
    console.error("Error getting AI feedback:", error);
    return "피드백을 생성하는 중 오류가 발생했습니다.";
  }
}

export async function performOCR(imageBase64: string) {
  try {
    const response = await ai.models.generateContent({
      model: geminiModel,
      contents: {
        parts: [
          { text: "Extract all the handwritten text from this image. Return only the extracted text." },
          { inlineData: { data: imageBase64, mimeType: "image/jpeg" } }
        ]
      }
    });
    return response.text;
  } catch (error) {
    console.error("OCR error:", error);
    return null;
  }
}

async function fetchImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(",")[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
